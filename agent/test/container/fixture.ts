import assert from 'node:assert/strict';
import { chown, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { EngineManifest, Offer } from '@beetle/contracts';
import type { InstallationProfile } from '../../src/backends/docker/index.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import type { Docker, Daemon, Image } from './docker.js';

export const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export async function fixture(docker: Docker, agentTag: string, engineTag: string, workStatus: number) {
  const agentImage = docker.json<Image[]>(['image', 'inspect', agentTag])[0]!;
  const engineImage = docker.json<Image[]>(['image', 'inspect', engineTag])[0]!;
  const info = docker.json<Daemon>(['info', '--format', '{{json .}}']);
  const architecture = info.Architecture === 'aarch64' ? 'arm64' : info.Architecture === 'x86_64' ? 'amd64' : info.Architecture;
  assert(['amd64', 'arm64'].includes(architecture)); assert.equal(info.OSType, 'linux');
  for (const image of [agentImage, engineImage]) { assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, architecture); }
  const uid = process.getuid!() || 1000; const gid = process.getgid!() || 1000; const user = `${uid}:${gid}`;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-agent-evidence-'))); await chown(root, uid, gid);
  for (const name of ['staging', 'journal', 'inputs', 'config']) {
    await mkdir(join(root, name), { mode: 0o700 }); await chown(join(root, name), uid, gid);
  }
  const id = randomUUID(); const agent = `beetle-agent-${id}`; const target = `beetle-target-${id}`;
  const network = `beetle-native-${id}`; const configPath = join(root, 'config', 'agent.json');
  const tokenPath = join(root, 'config', 'credential');
  for (const [path, text] of [[configPath, '{}'], [tokenPath, randomBytes(48).toString('base64url')]]) {
    await writeFile(path!, text!, { mode: 0o600 }); await chown(path!, uid, gid);
  }
  const budget = { cpuMillis: 1000, memoryBytes: 536870912, pids: 128, timeoutMs: 30000, outputBytes: 16777216 };
  const schema = createK6ConfigSchema(digest);
  const manifest = JSON.parse(await readFile(new URL('../../../contracts/fixtures/valid/manifest.json', import.meta.url), 'utf8')) as EngineManifest;
  Object.assign(manifest, { engineVersion: '2.2.0', imageDigest: engineImage.Id, defaultBudget: budget,
    minimumBudget: { ...budget, timeoutMs: 1, outputBytes: 1 }, entrypoint: { executable: 'node', arguments: ['/beetle/bootstrap/main.js'] } });
  manifest.schemas.config = schema.schemaId;
  for (const phase of manifest.phases) Object.assign(phase, { timeoutMs: 5000, outputBytes: 4194304 });
  const profile: InstallationProfile = { installationId: id, imageDigest: engineImage.Id,
    effectiveImage: { imageDigest: engineImage.Id, environment: engineImage.Config.Env, defaultRuntime: info.DefaultRuntime },
    entrypoint: manifest.entrypoint, user, stagingRoot: join(root, 'staging'),
    network: { profile: 'target-egress', name: network }, tmpfsBytes: 16777216, maximumBudget: budget };
  const offer = JSON.parse(await readFile(new URL('../../../contracts/fixtures/valid/offer.json', import.meta.url), 'utf8')) as Offer;
  const revision = JSON.parse(await readFile(new URL('../../../contracts/fixtures/api/valid/suite-revision.json', import.meta.url), 'utf8')) as { config: Offer['config'] };
  Object.assign(offer, { attemptId: randomUUID(), intentDigest: digest(id), engine: { id: 'k6', imageDigest: engineImage.Id, configVersion: 1 },
    budget, inputs: [], secretReferences: [], executionPolicy: { mode: 'parallel', preferIdle: false }, config: revision.config });
  offer.config.target = 'http://target:8080';
  offer.config.requests = [{ id: 'get', name: 'owned', method: 'GET', path: '/work', query: {}, headers: {},
    assertions: [{ id: 'required', required: true, kind: 'statusEq', value: 200 }] }];
  offer.config.readiness = { path: '/ready', attempts: 1, intervalMs: 0, timeoutMs: 1000, wallBudgetMs: 1000, expectedStatus: 200, assertions: [] };
  const engine = runtimeName({ installationId: id, ...offer, generation: 1 });
  return { docker, root, id, agent, target, engine, network, configPath, tokenPath, user, uid, gid,
    info, agentImage, engineImage, architecture, budget, manifest, profile, offer, workStatus };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export async function saveConfiguration(f: Fixture, agentImageId: string): Promise<void> {
  const resources = { cpuMillis: 2000, memoryBytes: 1073741824, pids: 256, outputBytes: 67108864, stagingBytes: 67108864 };
  const reserve = { cpuMillis: 250, memoryBytes: 134217728, pids: 16, outputBytes: 0, stagingBytes: 0 };
  await writeFile(f.configPath, JSON.stringify({ version: 1,
    installation: { installationId: f.id, stagingRoot: f.profile.stagingRoot, expectedDaemonId: f.info.ID,
      agentContainer: f.agent, agentImageId, user: f.user }, dockerSocket: '/var/run/docker.sock',
    journalDirectory: join(f.root, 'journal'), credentialFile: f.tokenPath, minimumFreeBytes: 16777216,
    configuration: { pool: resources, perRun: { ...resources, cpuMillis: 1000, memoryBytes: 536870912, pids: 128 },
      controlReserve: reserve, headroom: reserve, maxConcurrent: 1, maxTimeoutMs: 30000, observationTtlMs: 5000, requiredSensors: [] },
    providers: { inputRoot: join(f.root, 'inputs'), secretBindings: [] }, engines: [{ manifest: f.manifest, profile: f.profile,
      configVersion: 1, manifestId: 'k6-native', profileId: 'native', catalogVersion: 1 }], listen: { host: '127.0.0.1', port: 4312 } }), { mode: 0o600 });
}
