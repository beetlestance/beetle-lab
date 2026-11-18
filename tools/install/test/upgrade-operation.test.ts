import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { build } from 'tsup';
import { mkdtemp, rm, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { fixture, agentId, engineId } from './fixtures.js';
import { provisionFreshInstallation, inspectReadyConfiguration } from '../index.js';
import { ProvisionError, UpgradeBlockedError } from '../types.js';
import { changeInstalledCapacity } from '../capacity/index.js';
import { upgradeInstallation } from '../upgrade/index.js';
import type { UpgradeAction } from '../upgrade/index.js';
import { upgradeNative } from '../upgrade/files.js';
import { configurationStatePath } from '../src/configuration.js';
import { native } from '../src/files.js';
import { openMetadata } from '../../../app/src/adapters/outbound/sqlite/index.js';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import { openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import type { DockerRequest, DockerReply } from '../../../agent/src/backends/docker/index.js';

const f = fixture();
let worker: URL;
let bundle: string;
const scratch: string[] = [];
beforeAll(async () => {
  bundle = await mkdtemp(join(tmpdir(), 'beetle-upgrade-worker-'));
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
const nextEngine = 'sha256:' + 'e'.repeat(64);
const nextAgent = 'sha256:' + 'd'.repeat(64);
async function setup() {
  const e = await f.setup();
  const installed = await provisionFreshInstallation(e.request, e.context);
  const record = JSON.parse(await readFile(installed.paths.installation, 'utf8'));
  const metadataPath = join(installed.paths.backendData, 'metadata.sqlite');
  const metadata = await openMetadata({ path: metadataPath, workerUrl: worker, installation: record, runtime: null });
  await metadata.close();
  await writeFile(join(installed.paths.backendData, 'history-canary'), 'keep', { mode: 0o600 });
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'beetle-upgrade-home-')));
  scratch.push(outside);
  const extra = join(outside, 'bootstrap.sqlite');
  await writeFile(extra, 'bootstrap-canary', { mode: 0o600 });
  let agentPin = agentId;
  let enginePin = engineId;
  let engines: unknown[] = [];
  let agentState = 'exited';
  const docker = {
    async request(input: DockerRequest): Promise<DockerReply> {
      if (input.path === `/v1.47/containers/${e.request.agentContainer}/json`)
        return { ok: true, status: 200, body: { Id: 'a'.repeat(64), State: { Status: agentState } } };
      if (input.path.startsWith('/v1.47/containers/json?')) return { ok: true, status: 200, body: engines };
      const reply = await e.context.docker.request(input);
      if (input.path.startsWith('/v1.47/images/') && reply.ok)
        return {
          ...reply,
          body: { ...(reply.body as Record<string, unknown>), Id: input.path.includes('agent') ? agentPin : enginePin },
        };
      return reply;
    },
  };
  const context = () => ({ ...e.context, docker, backendWorkerUrl: worker, deadline: performance.now() + 30000 });
  const run = (action: UpgradeAction) =>
    upgradeInstallation(
      {
        request: e.request,
        action,
        upgradeDirectory: join(outside, 'upgrade'),
        extras: [{ name: 'bootstrap.sqlite', path: extra }],
      },
      context(),
    );
  const loaded = async () => {
    const value = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: installed.paths.agent }, f.worker());
    try {
      return {
        agent: value.runtime.installation.agentImageId,
        engine: value.runtime.catalog.engines[0]!.profile.imageDigest,
      };
    } finally {
      await value.close();
    }
  };
  const userVersion = () => {
    const db = new DatabaseSync(metadataPath, { readOnly: true });
    try {
      return db.prepare('PRAGMA user_version').get()!.user_version;
    } finally {
      db.close();
    }
  };
  return {
    ...e,
    installed,
    metadataPath,
    outside,
    extra,
    context,
    run,
    loaded,
    userVersion,
    selector: () => readFile(configurationStatePath(e.root), 'utf8').then((text) => JSON.parse(text)),
    movePins(engine = nextEngine) {
      agentPin = nextAgent;
      enginePin = engine;
    },
    setEngines(value: unknown[]) {
      engines = value;
    },
    setAgentState(value: string) {
      agentState = value;
    },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpgradeBlockedError) return `upgrade_blocked:${error.items.join(',')}`;
    if (error instanceof ProvisionError) return error.code;
    throw error;
  }
  return 'resolved';
}
async function snapshot(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, path));
    else {
      const bytes = await readFile(join(root, path));
      // Read-only inspection may leave an empty WAL and its index; neither carries data.
      if (path.endsWith('-shm') || (path.endsWith('-wal') && bytes.length === 0)) continue;
      result[path] = bytes.toString('base64');
    }
  }
  return result;
}
async function prepared(e: Setup) {
  e.movePins();
  return e.run('prepare');
}

it('names the upgrade command when images move and keeps recovery_required for other drift', async () => {
  const e = await setup();
  expect((await provisionFreshInstallation(e.request, e.context())).status).toBe('unchanged');
  e.movePins();
  expect(await code(provisionFreshInstallation(e.request, e.context()))).toBe('upgrade_required');
  expect(await code(inspectReadyConfiguration(e.request, e.context()))).toBe('upgrade_required');
  const other = { ...e.request, externalOrigin: 'https://other.invalid' };
  expect(await code(provisionFreshInstallation(other, e.context()))).not.toBe('upgrade_required');
});

it('prepares a fenced, sealed upgrade, then activates and replays as unchanged', async () => {
  const e = await setup();
  const baseline = await readFile(e.installed.paths.receipt);
  const tokenPath = join(e.root, 'config/agent-token');
  const token = await readFile(tokenPath);
  expect(await e.run('status')).toMatchObject({ status: 'none' });
  const result = await prepared(e);
  expect(result).toMatchObject({
    status: 'awaiting_activation',
    installationId: e.installed.installationId,
    to: { agent: nextAgent, engines: [{ imageDigest: nextEngine }] },
    from: { agent: agentId, engines: [{ imageDigest: engineId }] },
    steps: ['configuration', 'journal', 'metadata'],
  });
  const selector = await e.selector();
  expect(selector.upgradeFence).toBe(result.operationId);
  expect(selector.generation.operationId).toBe(result.operationId);
  expect(await e.loaded()).toEqual({ agent: nextAgent, engine: nextEngine });
  expect(await readFile(e.installed.paths.receipt)).toEqual(baseline);
  expect(await readFile(tokenPath)).toEqual(token);
  expect(e.userVersion()).toBeGreaterThan(0);
  expect((await inspectReadyConfiguration(e.request, e.context())).upgrade).toBe('awaiting_activation');
  // Capacity changes stay closed while the fence is held.
  const increase = { resource: 'outputPool' as const, bytes: 2147483648 };
  const capacity = { request: e.request, operationId: '00000000-0000-4000-8000-000000000096', increase };
  expect(await code(changeInstalledCapacity(capacity, e.context()))).toBe('upgrade_blocked');
  expect(await e.run('prepare')).toMatchObject({ status: 'awaiting_activation', operationId: result.operationId });
  expect(await e.run('activate')).toMatchObject({ status: 'activated' });
  expect(await e.run('activate')).toMatchObject({ status: 'activated' });
  expect((await e.selector()).upgradeFence).toBeUndefined();
  expect((await provisionFreshInstallation(e.request, e.context())).status).toBe('unchanged');
  expect((await inspectReadyConfiguration(e.request, e.context())).upgrade).toBe('none');
  expect(await e.run('prepare')).toMatchObject({ status: 'unchanged' });
  expect(await code(e.run('rollback'))).toBe('upgrade_blocked:activated');
  expect(await readFile(join(e.installed.paths.backendData, 'history-canary'), 'utf8')).toBe('keep');
});

it('refuses live containers and held serving leases before writing anything', async () => {
  const e = await setup();
  e.movePins();
  e.setEngines([{ State: 'running' }]);
  e.setAgentState('running');
  expect(await code(e.run('prepare'))).toBe('upgrade_blocked:engine_containers,agent_container');
  expect(await e.run('status')).toMatchObject({ status: 'none' });
  e.setEngines([{ State: 'exited' }]);
  e.setAgentState('created');
  const lease = openBackendRecovery(
    join(e.installed.paths.backendData, 'recovery-control.sqlite'),
    e.installed.installationId,
  );
  try {
    expect(await code(e.run('prepare'))).toBe('conflict');
  } finally {
    lease.close();
  }
  expect(await e.run('status')).toMatchObject({ status: 'none' });
  expect((await e.selector()).upgradeFence).toBeUndefined();
});

/** The disposable test root drops one table's guard triggers so a synthetic blocker row can exist. */
function insertUnguarded(db: DatabaseSync, table: string, sql: string): void {
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table);
  for (const { name } of triggers) db.exec(`DROP TRIGGER "${String(name)}"`);
  db.prepare(sql).run();
}
it('names nonterminal metadata and Journal work as quiescence blockers', async () => {
  const e = await setup();
  e.movePins();
  const options = { enableForeignKeyConstraints: false };
  const metadata = new DatabaseSync(e.metadataPath, options);
  const journal = new DatabaseSync(join(e.installed.paths.agentJournal, 'journal.sqlite'), options);
  try {
    insertUnguarded(
      metadata,
      'dispatch_outbox',
      "INSERT INTO dispatch_outbox(attempt_id,intent_digest) VALUES ('synthetic','synthetic')",
    );
    insertUnguarded(
      journal,
      'admission_queue',
      "INSERT INTO admission_queue(attempt_id,candidate_json,pending) VALUES ('x','{}',1)",
    );
  } finally {
    metadata.close();
    journal.close();
  }
  expect(await code(e.run('prepare'))).toBe('upgrade_blocked:dispatch_outbox,journal_admission_queue');
  expect(await e.run('status')).toMatchObject({ status: 'none' });
});

it('rolls back before activation to the exact sealed bytes, leaving the old images pinned', async () => {
  const e = await setup();
  const before = await snapshot(e.root);
  const result = await prepared(e);
  expect(await snapshot(e.root)).not.toEqual(before);
  await writeFile(e.extra, 'changed-after-backup', { mode: 0o600 });
  expect(await e.run('rollback')).toMatchObject({ status: 'rolled_back', operationId: result.operationId });
  expect(await snapshot(e.root)).toEqual(before);
  expect(await e.loaded()).toEqual({ agent: agentId, engine: engineId });
  expect(await e.run('rollback')).toMatchObject({ status: 'rolled_back' });
  expect(await code(e.run('activate'))).toBe('upgrade_blocked:not_awaiting_activation');
  // Old pins are still installed, so normal startup names the upgrade again.
  expect(await code(provisionFreshInstallation(e.request, e.context()))).toBe('upgrade_required');
  expect(await e.run('prepare')).toMatchObject({ status: 'awaiting_activation' });
});

it('resumes an interrupted rollback swap after the root moved aside', async () => {
  const e = await setup();
  const before = await snapshot(e.root);
  const result = await prepared(e);
  const rename = upgradeNative.rename;
  const failure = vi.spyOn(upgradeNative, 'rename').mockImplementation(async (from, to) => {
    if (String(from).endsWith('restore.partial')) throw new Error('synthetic swap failure');
    return rename(from, to);
  });
  await expect(e.run('rollback')).rejects.toThrow('synthetic');
  failure.mockRestore();
  expect(await e.run('status')).toMatchObject({ status: 'rolling_back', operationId: result.operationId });
  expect(await code(e.run('prepare'))).toBe('upgrade_blocked:rollback_pending');
  expect(await e.run('rollback')).toMatchObject({ status: 'rolled_back' });
  expect(await snapshot(e.root)).toEqual(before);
});

const faults = [
  ['first receipt', 'upgrade', 'receipt.json', 1],
  ['sealed-backup receipt', 'upgrade', 'receipt.json', 2],
  ['configuration step receipt', 'upgrade', 'receipt.json', 3],
  ['metadata step receipt', 'upgrade', 'receipt.json', 5],
  ['final receipt', 'upgrade', 'receipt.json', 6],
  ['backup publication', 'upgrade', 'backup', 1],
  ['selector publication', 'installer', '-upgrade', 1],
] as const;
it.each(faults)('resumes preparation after a failed %s write', async (_label, seam, marker, occurrence) => {
  const e = await setup();
  e.movePins();
  const target = seam === 'upgrade' ? upgradeNative : native;
  const rename = target.rename;
  let seen = 0;
  vi.spyOn(target, 'rename').mockImplementation(async (from, to) => {
    const path = seam === 'upgrade' ? String(to) : String(from);
    if ((seam === 'upgrade' ? path.endsWith(marker) : path.includes(marker)) && ++seen === occurrence)
      throw new Error('synthetic upgrade write failure');
    return rename(from, to);
  });
  await expect(e.run('prepare')).rejects.toThrow('synthetic');
  vi.restoreAllMocks();
  expect(await e.run('prepare')).toMatchObject({ status: 'awaiting_activation' });
  expect(await e.loaded()).toEqual({ agent: nextAgent, engine: nextEngine });
  expect(await e.run('activate')).toMatchObject({ status: 'activated' });
  expect((await provisionFreshInstallation(e.request, e.context())).status).toBe('unchanged');
});

it('refuses activation when images move again, and rollback still restores the old pins', async () => {
  const e = await setup();
  const result = await prepared(e);
  e.movePins('sha256:' + '1'.repeat(64));
  expect(await e.run('prepare')).toMatchObject({ status: 'awaiting_activation', operationId: result.operationId });
  expect(await code(e.run('activate'))).toBe('recovery_required');
  expect(await e.run('rollback')).toMatchObject({ status: 'rolled_back' });
  expect(await e.loaded()).toEqual({ agent: agentId, engine: engineId });
});
