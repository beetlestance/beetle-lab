import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { build } from 'tsup';
import { chmod, mkdtemp, rm, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { fixture, agentId, engineId } from './fixtures.js';
import { provisionFreshInstallation } from '../index.js';
import { BindingChangedError, OriginBlockedError, ProvisionError, UpgradeBlockedError } from '../types.js';
import { changeInstalledCapacity } from '../capacity/index.js';
import { changeInstallationOrigin } from '../origin/index.js';
import { upgradeInstallation } from '../upgrade/index.js';
import type { UpgradeAction } from '../upgrade/index.js';
import { upgradeNative } from '../upgrade/files.js';
import { installedRequest } from '../src/installed-request.js';
import { canonical, digest } from '../src/capture.js';
import { configurationStatePath } from '../src/configuration.js';
import { native } from '../src/files.js';
import { openMetadata } from '../../../app/src/adapters/outbound/sqlite/index.js';
import { openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import type { DockerRequest, DockerReply } from '../../../agent/src/backends/docker/index.js';

const f = fixture();
let worker: URL;
let bundle: string;
const scratch: string[] = [];
beforeAll(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'beetle-origin-worker-'));
  await build({
    entry: ['app/src/adapters/outbound/sqlite/worker.ts'],
    outDir: bundle,
    format: ['esm'],
    platform: 'node',
    target: 'node24',
    bundle: true,
    noExternal: [/.*/],
    shims: true,
    removeNodeProtocol: false,
    splitting: false,
    silent: true,
  });
  worker = pathToFileURL(join(bundle, 'worker.js'));
}, 20000);
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const BASELINE = 'https://synthetic.invalid';
const LAB = 'https://lab.example.internal';
const OTHER = 'https://other.example.internal';
const ids = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'] as const;
const third = '00000000-0000-4000-8000-0000000000a3';

async function setup() {
  const e = await f.setup();
  expect(e.request.externalOrigin).toBe(BASELINE);
  const installed = await provisionFreshInstallation(e.request, e.context);
  const record = JSON.parse(await readFile(installed.paths.installation, 'utf8'));
  const metadataPath = join(installed.paths.backendData, 'metadata.sqlite');
  const metadata = await openMetadata({ path: metadataPath, workerUrl: worker, installation: record, runtime: null });
  await metadata.close();
  await chmod(metadataPath, 0o600);
  const home = await realpath(await mkdtemp(join(tmpdir(), 'beetle-origin-home-')));
  scratch.push(home);
  let agentState = 'exited';
  let pins = { agent: agentId, engine: engineId };
  const docker = {
    async request(input: DockerRequest): Promise<DockerReply> {
      if (input.path === `/v1.47/containers/${e.request.agentContainer}/json`)
        return {
          ok: true,
          status: 200,
          body: {
            Id: 'a'.repeat(64),
            Image: agentId,
            State: { Status: agentState, Running: agentState === 'running', Restarting: false, Dead: false, Pid: 0 },
            Config: { Env: [`BEETLE_AGENT_CONFIG_FILE=${installed.paths.agent}`] },
          },
        };
      if (input.path.startsWith('/v1.47/containers/json?')) return { ok: true, status: 200, body: [] };
      const reply = await e.context.docker.request(input);
      if (input.path.startsWith('/v1.47/images/') && reply.ok)
        return {
          ...reply,
          body: { ...(reply.body as Record<string, unknown>), Id: input.path.includes('agent') ? pins.agent : pins.engine },
        };
      return reply;
    },
  };
  const context = () => ({ ...e.context, docker, backendWorkerUrl: worker, deadline: performance.now() + 30000 });
  /** What `setup origin` does: resolve the recorded request, then change from `from` to `to`. */
  const change = async (from: string, to: string, operationId: string) => {
    const request = await installedRequest({ ...e.request, externalOrigin: to }, context(), undefined, [from, to]);
    return changeInstallationOrigin(
      {
        request,
        from,
        to,
        operationId,
        originDirectory: join(home, 'origin'),
        upgradeDirectory: join(home, 'upgrade'),
      },
      context(),
    );
  };
  /** What every later start does; the baseline stands in for Compose's loopback default. */
  const start = (origin: string) => installedRequest({ ...e.request, externalOrigin: origin }, context(), BASELINE);
  const upgrade = (action: UpgradeAction) =>
    upgradeInstallation(
      {
        request: e.request,
        action,
        upgradeDirectory: join(home, 'upgrade'),
        originDirectory: join(home, 'origin'),
        extras: [],
      },
      context(),
    );
  return {
    ...e,
    installed,
    home,
    context,
    change,
    start,
    upgrade,
    selector: () => readFile(configurationStatePath(e.root), 'utf8').then((text) => JSON.parse(text)),
    records: () => readFile(join(home, 'origin', 'operations.json'), 'utf8').then((text) => JSON.parse(text)),
    setAgentState(value: string) {
      agentState = value;
    },
    movePins() {
      pins = { agent: 'sha256:' + 'd'.repeat(64), engine: 'sha256:' + 'e'.repeat(64) };
    },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OriginBlockedError || error instanceof UpgradeBlockedError || error instanceof BindingChangedError)
      return `${error.code}:${error.items.join(',')}`;
    if (error instanceof ProvisionError) return error.code;
    throw error;
  }
  return 'resolved';
}
/** Every file under the root except the selector, which is the one file an origin change writes. */
async function contents(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await contents(root, path));
    else if (path !== join('config', 'configuration-state.json') && !path.endsWith('-shm') && !path.endsWith('-wal'))
      result[path] = (await readFile(join(root, path))).toString('base64');
  }
  return result;
}
const recorded = async (e: Setup) =>
  (JSON.parse(await readFile(join(e.root, 'installation.json'), 'utf8')) as { requestDigest: string }).requestDigest;
function failRename(target: typeof native | typeof upgradeNative, matches: (from: string, to: string) => boolean) {
  const rename = target.rename;
  return vi.spyOn(target, 'rename').mockImplementation(async (from, to) => {
    if (matches(String(from), String(to))) throw new Error('synthetic origin write failure');
    return rename(from, to);
  });
}

it('changes the served origin offline, keeps every other byte, and replays as unchanged', async () => {
  const e = await setup();
  const before = await contents(e.root);
  const receipt = await readFile(join(e.root, 'installation.json'));
  expect(await e.change(BASELINE, LAB, ids[0])).toMatchObject({
    status: 'changed',
    installationId: e.installed.installationId,
    operationId: ids[0],
  });
  expect((await e.selector()).origin).toEqual({ version: 1, operationId: ids[0], baseline: BASELINE, current: LAB });
  expect(await e.records()).toMatchObject({ operations: [{ operationId: ids[0], from: BASELINE, to: LAB, phase: 'committed' }] });
  // Suites, runs, credentials, settings, configuration and the baseline receipt are untouched.
  expect(await contents(e.root)).toEqual(before);
  expect(await readFile(join(e.root, 'installation.json'))).toEqual(receipt);
  // Startup now accepts the new origin and still proves the original fingerprint.
  const request = await e.start(LAB);
  expect(request.externalOrigin).toBe(BASELINE);
  expect(digest(canonical(request))).toBe(await recorded(e));
  expect((await provisionFreshInstallation(request, e.context())).status).toBe('unchanged');
  expect(await code(e.start(BASELINE))).toBe('binding_changed:external_origin');
  expect(await code(e.start(OTHER))).toBe('binding_changed:external_origin');
  expect(await e.change(BASELINE, LAB, ids[0])).toMatchObject({ status: 'unchanged' });
});

it('returns to the baseline by removing the field, and a stale replay cannot overwrite the newer change', async () => {
  const e = await setup();
  await e.change(BASELINE, LAB, ids[0]);
  expect(await e.change(LAB, BASELINE, ids[1])).toMatchObject({ status: 'changed' });
  expect(Object.hasOwn(await e.selector(), 'origin')).toBe(false);
  expect(digest(canonical(await e.start(BASELINE)))).toBe(await recorded(e));
  // Replaying the first operation answers from its record and writes nothing.
  const selector = await readFile(configurationStatePath(e.root));
  const records = await readFile(join(e.home, 'origin', 'operations.json'));
  expect(await e.change(BASELINE, LAB, ids[0])).toMatchObject({ status: 'unchanged' });
  expect(await e.change(LAB, BASELINE, ids[1])).toMatchObject({ status: 'unchanged' });
  expect(await readFile(configurationStatePath(e.root))).toEqual(selector);
  expect(await readFile(join(e.home, 'origin', 'operations.json'))).toEqual(records);
  expect(await code(e.start(LAB))).toBe('binding_changed:external_origin');
});

it('refuses a reused operation ID with other origins and a stale --from by name', async () => {
  const e = await setup();
  await e.change(BASELINE, LAB, ids[0]);
  const selector = await readFile(configurationStatePath(e.root));
  expect(await code(e.change(BASELINE, OTHER, ids[0]))).toBe('conflict');
  expect(await code(e.change(BASELINE, OTHER, ids[1]))).toBe('binding_changed:external_origin');
  expect(await code(e.change(OTHER, LAB, ids[1]))).toBe('binding_changed:external_origin');
  expect(await readFile(configurationStatePath(e.root))).toEqual(selector);
  expect(await e.change(LAB, OTHER, ids[1])).toMatchObject({ status: 'changed' });
  expect((await e.selector()).origin).toMatchObject({ baseline: BASELINE, current: OTHER, operationId: ids[1] });
});

it('resumes after an interrupted selector publication and blocks other operations meanwhile', async () => {
  const e = await setup();
  const failure = failRename(native, (from) => from.includes(`${ids[0]}-origin`));
  await expect(e.change(BASELINE, LAB, ids[0])).rejects.toThrow('synthetic');
  failure.mockRestore();
  expect(Object.hasOwn(await e.selector(), 'origin')).toBe(false);
  expect(await e.records()).toMatchObject({ operations: [{ operationId: ids[0], phase: 'pending' }] });
  // The installation still serves the old origin, and nothing else may start.
  expect(digest(canonical(await e.start(BASELINE)))).toBe(await recorded(e));
  expect(await code(e.change(BASELINE, OTHER, ids[1]))).toBe('origin_blocked:origin_change_pending');
  e.movePins();
  expect(await code(e.upgrade('prepare'))).toBe('upgrade_blocked:origin_change');
  expect(await e.upgrade('status')).toMatchObject({ status: 'none' });
  expect(await e.change(BASELINE, LAB, ids[0])).toMatchObject({ status: 'changed' });
  expect((await e.selector()).origin).toMatchObject({ current: LAB });
  expect(await e.records()).toMatchObject({ operations: [{ operationId: ids[0], phase: 'committed' }] });
});

it('finishes an operation interrupted after the selector moved but before its record was committed', async () => {
  const e = await setup();
  let writes = 0;
  const failure = failRename(upgradeNative, (_from, to) => to.endsWith('operations.json') && ++writes === 2);
  await expect(e.change(BASELINE, LAB, ids[0])).rejects.toThrow('synthetic');
  failure.mockRestore();
  expect((await e.selector()).origin).toMatchObject({ current: LAB });
  expect(await e.records()).toMatchObject({ operations: [{ operationId: ids[0], phase: 'pending' }] });
  const selector = await readFile(configurationStatePath(e.root));
  expect(await e.change(BASELINE, LAB, ids[0])).toMatchObject({ status: 'changed' });
  expect(await readFile(configurationStatePath(e.root))).toEqual(selector);
  expect(await e.records()).toMatchObject({ operations: [{ operationId: ids[0], phase: 'committed' }] });
});

it('refuses a running agent and held startup leases without writing anything', async () => {
  const e = await setup();
  const selector = await readFile(configurationStatePath(e.root));
  e.setAgentState('running');
  expect(await code(e.change(BASELINE, LAB, ids[0]))).toBe('origin_blocked:agent_container');
  e.setAgentState('created');
  const lease = openBackendRecovery(
    join(e.installed.paths.backendData, 'recovery-control.sqlite'),
    e.installed.installationId,
  );
  try {
    expect(await code(e.change(BASELINE, LAB, ids[0]))).toBe('conflict');
  } finally {
    lease.close();
  }
  expect(await readFile(configurationStatePath(e.root))).toEqual(selector);
  await expect(readFile(join(e.home, 'origin', 'operations.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('is refused during an unfinished upgrade, and an activated upgrade keeps the changed origin', async () => {
  const e = await setup();
  await e.change(BASELINE, LAB, ids[0]);
  e.movePins();
  expect(await e.upgrade('prepare')).toMatchObject({ status: 'awaiting_activation' });
  expect(await code(e.change(LAB, OTHER, ids[1]))).toBe('origin_blocked:upgrade');
  expect(await e.upgrade('activate')).toMatchObject({ status: 'activated' });
  expect((await e.selector()).origin).toMatchObject({ baseline: BASELINE, current: LAB, operationId: ids[0] });
  expect(digest(canonical(await e.start(LAB)))).toBe(await recorded(e));
  expect(await e.change(LAB, OTHER, ids[1])).toMatchObject({ status: 'changed' });
});

it('restores the origin the upgrade was prepared with when that upgrade rolls back', async () => {
  const e = await setup();
  await e.change(BASELINE, LAB, ids[0]);
  const selector = await readFile(configurationStatePath(e.root));
  e.movePins();
  await e.upgrade('prepare');
  expect(await e.upgrade('rollback')).toMatchObject({ status: 'rolled_back' });
  expect(await readFile(configurationStatePath(e.root))).toEqual(selector);
  expect(await e.change(LAB, OTHER, ids[1])).toMatchObject({ status: 'changed' });
});

it('is refused during an unfinished capacity change, and a later capacity change keeps the origin', async () => {
  const e = await setup();
  const capacity = {
    request: e.request,
    operationId: third,
    increase: { resource: 'outputPool' as const, bytes: 2147483648 },
  };
  const failure = failRename(native, (from) => from.includes(`${third}-commit`));
  await expect(changeInstalledCapacity(capacity, e.context())).rejects.toThrow('synthetic');
  failure.mockRestore();
  expect(await code(e.change(BASELINE, LAB, ids[0]))).toBe('origin_blocked:capacity_change');
  expect(await changeInstalledCapacity(capacity, e.context())).toMatchObject({ status: 'changed' });
  expect(await e.change(BASELINE, LAB, ids[0])).toMatchObject({ status: 'changed' });
  const more = { ...capacity, operationId: ids[1], increase: { resource: 'outputPool' as const, bytes: 3221225472 } };
  expect(await changeInstalledCapacity({ ...more, request: await e.start(LAB) }, e.context())).toMatchObject({
    status: 'changed',
  });
  const selector = await e.selector();
  expect(selector.origin).toMatchObject({ current: LAB, operationId: ids[0] });
  expect(selector.generation.operationId).toBe(ids[1]);
  expect(digest(canonical(await e.start(LAB)))).toBe(await recorded(e));
});

it('lets older releases fail closed on the field rather than serve the baseline origin', async () => {
  const e = await setup();
  await e.change(BASELINE, LAB, ids[0]);
  // A selector field the reader does not know is refused, as an older release refuses `origin`.
  const selector = await e.selector();
  await writeFile(configurationStatePath(e.root), JSON.stringify({ ...selector, futureField: 1 }), { mode: 0o600 });
  expect(await code(provisionFreshInstallation(await e.start(LAB), e.context()))).toBe('recovery_required');
  await writeFile(configurationStatePath(e.root), JSON.stringify(selector), { mode: 0o600 });
  expect(digest(canonical(await e.start(LAB)))).toBe(await recorded(e));
});
