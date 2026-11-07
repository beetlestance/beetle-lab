import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, normalize, dirname } from 'node:path';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import type { DockerReply } from '../backends/docker/index.js';
import { Boundary, snapshot } from './bounds.js';
import { StagingError } from './types.js';
import type { InstallationConfiguration, StagingResult, VerifyInput, VerifiedRoot } from './types.js';

export interface RootIdentity { readonly configuration: InstallationConfiguration; readonly dev: number; readonly ino: number; readonly uid: number; readonly gid: number }
export type { VerifiedRoot } from './types.js';
const roots = new WeakMap<VerifiedRoot, RootIdentity>();
export function rootIdentity(root: VerifiedRoot): RootIdentity {
  const data = roots.get(root);
  if (!data) throw new StagingError('installation');
  return data;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StagingError('installation');
  return value as Record<string, unknown>;
}
function body(reply: DockerReply): Record<string, unknown> {
  if (!reply.ok || reply.status !== 200) throw new StagingError('installation');
  return record(JSON.parse(encodeJson(reply.body, 1_048_576)));
}
function configuration(input: InstallationConfiguration): InstallationConfiguration {
  const value = snapshot(input, 4096);
  if (!validatePrimitive('uuid', value.installationId).ok || !/^[1-9][0-9]{0,8}:[1-9][0-9]{0,8}$/u.test(value.user)) throw new StagingError('installation');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value.agentContainer)) throw new StagingError('installation');
  if (!/^sha256:[a-f0-9]{64}$/u.test(value.agentImageId) || !/^[A-Za-z0-9:._-]{1,128}$/u.test(value.expectedDaemonId)) throw new StagingError('installation');
  const root = value.stagingRoot;
  if (!validPath(root)) throw new StagingError('installation');
  return value;
}
function validPath(root: string): boolean {
  return isAbsolute(root) && root !== '/' && normalize(root) === root && root.length <= 512
    && !Array.from(root).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function inspectAgent(raw: Record<string, unknown>, config: InstallationConfiguration): void {
  const state = record(raw.State); const imageConfig = record(raw.Config);
  const exactId = /^[a-f0-9]{64}$/u.test(config.agentContainer);
  if ((exactId ? raw.Id !== config.agentContainer : raw.Name !== `/${config.agentContainer}`)
    || raw.Image !== config.agentImageId || imageConfig.User !== config.user) throw new StagingError('installation');
  if (state.Running !== true || state.Paused !== false || state.Restarting !== false || state.Dead !== false) throw new StagingError('installation');
  inspectMounts(raw.Mounts, config.stagingRoot);
}
function inspectMounts(raw: unknown, root: string): void {
  if (!Array.isArray(raw) || raw.length > 128) throw new StagingError('installation');
  let exact = 0;
  for (const item of raw) {
    const mount = record(item); const destination = mount.Destination;
    checkDestination(destination);
    if (destination === root) {
      exact++;
      checkMount(mount, root);
    } else checkOverlap(mount, root);
  }
  if (exact !== 1) throw new StagingError('installation');
}
function checkDestination(destination: unknown): asserts destination is string {
  if (typeof destination !== 'string' || !isAbsolute(destination) || normalize(destination) !== destination) throw new StagingError('installation');
}
function checkOverlap(mount: Record<string, unknown>, root: string): void {
  const paths = [mount.Destination, mount.Source].filter((path): path is string => typeof path === 'string');
  if (paths.some(path => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`))) throw new StagingError('installation');
}
function checkMount(mount: Record<string, unknown>, root: string): void {
  if (mount.Type !== 'bind' || mount.Source !== root || mount.RW !== true || mount.Propagation !== 'rprivate') throw new StagingError('installation');
}
export async function checkRoot(identity: RootIdentity, boundary: Boundary): Promise<void> {
  const root = identity.configuration.stagingRoot;
  const stat = await boundary.wait(() => lstat(root));
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino
    || stat.uid !== identity.uid || stat.gid !== identity.gid || (stat.mode & 0o022) !== 0) throw new StagingError('installation');
  if (await boundary.wait(() => realpath(root)) !== root) throw new StagingError('installation');
}
async function localRoot(config: InstallationConfiguration, boundary: Boundary): Promise<RootIdentity> {
  const [uid, gid] = config.user.split(':').map(Number);
  if (uid !== process.getuid?.() || gid !== process.getgid?.()) throw new StagingError('installation');
  let path = config.stagingRoot;
  while (true) {
    const stat = await boundary.wait(() => lstat(path));
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StagingError('installation');
    if (path === '/') break;
    path = dirname(path);
  }
  const stat = await boundary.wait(() => lstat(config.stagingRoot));
  const identity = Object.freeze({ configuration: config, dev: stat.dev, ino: stat.ino, uid: uid!, gid: gid! });
  await checkRoot(identity, boundary);
  await boundary.wait(() => access(config.stagingRoot, constants.W_OK | constants.X_OK));
  return identity;
}
/** Evidence is read-only installation verification, not cross-container visibility qualification. */
export async function verifyInstallation(input: VerifyInput): Promise<StagingResult<VerifiedRoot>> {
  let boundary: Boundary | undefined;
  try {
    const config = configuration(input.configuration);
    boundary = new Boundary(input.operation);
    const operation = { deadline: input.operation.deadline, signal: boundary.signal };
    const info = body(await boundary.wait(() => input.transport.request({ ...operation, method: 'GET', path: '/v1.47/info' })));
    if (info.OSType !== 'linux' || info.ID !== config.expectedDaemonId) throw new StagingError('installation');
    const inspect = body(await boundary.wait(() => input.transport.request({ ...operation, method: 'GET', path: `/v1.47/containers/${encodeURIComponent(config.agentContainer)}/json` })));
    inspectAgent(inspect, config);
    const identity = await localRoot(config, boundary);
    boundary.check();
    const root = Object.freeze({}) as VerifiedRoot;
    roots.set(root, identity);
    return { ok: true, value: root };
  } catch (error) { return { ok: false, reason: error instanceof StagingError ? error.reason : 'installation' }; }
  finally { boundary?.dispose(); }
}
