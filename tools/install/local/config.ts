import { join } from 'node:path';
import type { StarterOptions } from '../starter.js';
import { createStarterRequest } from '../starter.js';
import { digest, path } from '../src/capture.js';
import { ProvisionError } from '../types.js';

export interface LocalOptions {
  directory: string; uid: number; gid: number; dockerGid: number;
  dockerSocket: string; port: number; revision: string; instance: string;
}
const keys = ['--directory', '--uid', '--gid', '--docker-gid', '--docker-socket', '--port', '--revision', '--instance'];
function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('invalid_input');
}
function integer(value: string | undefined, minimum: number, maximum: number): number {
  valid(value !== undefined && /^(0|[1-9][0-9]{0,8})$/u.test(value));
  const number = Number(value); valid(number >= minimum && number <= maximum); return number;
}
export function localPath(value: string): void {
  path(value, 300); valid(!/[,:$'"\\#\s]/u.test(value.replaceAll(' ', '')));
}
export function parseLocalOptions(argv: readonly string[]): LocalOptions {
  valid(argv.length === 14 || argv.length === 16); const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!; const value = argv[index + 1]!;
    valid(keys.includes(key) && !args.has(key)); args.set(key, value);
  }
  for (const key of keys.slice(0, 7)) valid(args.has(key));
  const directory = args.get('--directory')!; const dockerSocket = args.get('--docker-socket')!;
  localPath(directory); localPath(dockerSocket);
  const uid = integer(args.get('--uid'), 1, 999999999); const gid = integer(args.get('--gid'), 1, 999999999);
  valid(uid === process.getuid?.() && gid === process.getgid?.());
  const revision = args.get('--revision')!; valid(/^[a-z0-9][a-z0-9_.-]{0,95}$/u.test(revision));
  const instance = args.get('--instance') ?? digest(directory).slice(0, 16);
  valid(/^[a-z0-9][a-z0-9-]{0,47}$/u.test(instance));
  return { directory, dockerSocket, uid, gid, revision, instance,
    dockerGid: integer(args.get('--docker-gid'), 0, 999999999), port: integer(args.get('--port'), 1, 65535) };
}
export function image(revision: string, component: string): string { return `beetle-local-${component}:${revision}`; }
export function deployment(options: LocalOptions): ReadonlyMap<string, string> {
  const o = options; const root = join(o.directory, 'data'); const setup = join(o.directory, 'setup');
  const starter: StarterOptions = { root, uid: o.uid, gid: o.gid, externalOrigin: `http://127.0.0.1:${o.port}`,
    agentOrigin: 'http://agent:4312', dockerSocket: '/var/run/docker.sock', agentContainer: `beetle-${o.instance}-agent`,
    agentImage: image(o.revision, 'agent'), engineImage: image(o.revision, 'engine'), targetNetwork: `beetle-${o.instance}-targets` };
  const env: Record<string, string | number> = { BEETLE_INSTANCE: o.instance, BEETLE_ROOT: root,
    BEETLE_REQUEST_FILE: join(setup, 'request.json'), BEETLE_UID: o.uid, BEETLE_GID: o.gid,
    BEETLE_DOCKER_GID: o.dockerGid, BEETLE_DOCKER_SOCKET: o.dockerSocket, BEETLE_PORT: o.port,
    BEETLE_SOURCE_REVISION: o.revision };
  for (const component of ['frontend', 'backend', 'agent', 'installer', 'engine']) env[`BEETLE_${component.toUpperCase()}_IMAGE`] = image(o.revision, component);
  return new Map([['options.json', JSON.stringify(starter) + '\n'],
    ['request.json', JSON.stringify(createStarterRequest(starter)) + '\n'],
    ['compose.env', Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n']]);
}
