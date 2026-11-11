import { expect, it, vi, afterEach } from 'vitest';
import { chmod, lstat, readFile, writeFile, symlink, link, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { provisionFreshInstallation, ProvisionError } from '../index.js';
import { fixture, agentId, engineId } from './fixtures.js';
import { directories } from '../src/configuration.js';
import { native } from '../src/files.js';
import { openServingState } from '../../../agent/src/installation-state/index.js';
import { loadAgentConfiguration, installationStatePath } from '../../../agent/src/bootstrap/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
import { openJournal, Journal } from '../../../agent/src/journal/index.js';
import { runCli } from '../cli.js';
import type { Offer } from '@beetle/contracts';
import { fileURLToPath } from 'node:url';
import { UnixDockerTransport } from '../../../agent/src/backends/docker/index.js';

const f = fixture();
afterEach(() => { vi.restoreAllMocks(); });
const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
const later = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }

it('creates coherent private files with actual read-only facts, Journal configuration and exact ready authority', async () => {
  const e = await f.setup(); const result = await provisionFreshInstallation(e.request, e.context);
  expect(result.status).toBe('created'); expect(e.calls.map(call => call.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
  expect(e.calls.map(call => call.path)).toEqual(['/v1.47/info', '/v1.47/images/synthetic-agent%3Av1/json',
    '/v1.47/images/synthetic-engine%3Av1/json', '/v1.47/networks/beetle-synthetic-target']);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC=1');
  for (const directory of ['', ...directories]) expect((await lstat(join(e.root, directory))).mode & 0o777).toBe(0o700);
  for (const file of ['installation.json', 'config/agent.json', 'config/installation.json', 'config/backend-agent.json',
    'config/agent-token', 'agent/journal/journal.sqlite', 'agent/journal/journal.sqlite.authority.sqlite']) {
    const stat = await lstat(join(e.root, file)); expect(stat.mode & 0o777).toBe(0o600); expect(stat.nlink).toBe(1);
  }
  const loaded = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: result.paths.agent }, f.worker());
  try {
    expect(loaded.runtime.installation.agentImageId).toBe(agentId);
    expect(loaded.runtime.installation.expectedDaemonId).toBe('synthetic-daemon');
    const engine = loaded.runtime.catalog.engines[0]!;
    expect(engine.profile.imageDigest).toBe(engineId); expect(engine.manifest.imageDigest).toBe(engineId);
    expect(engine.profile.effectiveImage.environment).toEqual(['PATH=/usr/bin', 'SYNTHETIC=1']);
    expect(engine.profile.maximumBudget).toEqual(e.request.installationValues.perRunCeilings);
    const backend = await loadBackendConfiguration({ BEETLE_CONFIG_FILE: result.paths.installation,
      BEETLE_AGENT_CONFIG_FILE: result.paths.backendAgent, BEETLE_DATA_DIR: result.paths.backendData,
      BEETLE_EXTERNAL_ORIGIN: e.request.externalOrigin }, f.worker());
    expect(backend.application.agent?.connection?.configuration.profiles[0]?.installedIdentity).toEqual(engine.installedIdentity);
    const gate = openServingState(installationStatePath(loaded.runtime.journal.path));
    const journal = await openJournal(loaded.runtime.journal);
    try {
      expect(await journal.journalAuthority()).toBe(gate.journalAuthority);
      expect(await journal.admission({ kind: 'reservations', limit: 1 })).toEqual({ reservations: [] });
      expect((await json(result.paths.receipt)).authority).toBe(gate.journalAuthority);
    } finally { await journal.close(); gate.close(); }
    const configuration = await json(result.paths.agent);
    expect(configuration.providers).toEqual({ inputRoot: join(e.root, 'backend/inputs/published'), secretBindings: [] });
  } finally { await loaded.close(); }
});

it('replays offline with four read-only fact inspections, without rewriting credential/settings, and accepts legitimate backend/agent data', async () => {
  const e = await f.setup(); const first = await provisionFreshInstallation(e.request, e.context);
  const token = await readFile(join(e.root, 'config/agent-token')); const seed = await readFile(first.paths.installation);
  const config = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: first.paths.agent }, f.worker());
  const journal = await openJournal(config.runtime.journal);
  const offer = JSON.parse(await readFile('contracts/fixtures/valid/offer.json', 'utf8')) as Offer;
  const engine = config.runtime.catalog.engines[0]!;
  offer.engine.imageDigest = engineId; offer.installedIdentity = engine.installedIdentity;
  let snapshot;
  try { snapshot = await journal.immutableOffer(offer); } finally { await journal.close(); await config.close(); }
  await writeFile(join(e.root, 'backend/runtime-data'), 'synthetic legitimate application data', { mode: 0o600 });
  await writeFile(join(e.root, 'agent/staging/runtime-data'), 'synthetic staging data', { mode: 0o600 });
  const second = await provisionFreshInstallation(e.request, e.context);
  expect(e.calls).toHaveLength(8);
  expect(second).toEqual({ ...first, status: 'unchanged' });
  const reopened = await openJournal({ path: join(first.paths.agentJournal, 'journal.sqlite'), workerUrl: f.worker() });
  try { expect(await reopened.get({ attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId })).toEqual(snapshot); } finally { await reopened.close(); }
  expect(await readFile(join(e.root, 'config/agent-token'))).toEqual(token); expect(await readFile(first.paths.installation)).toEqual(seed);
  expect(await readFile(join(e.root, 'backend/runtime-data'), 'utf8')).toBe('synthetic legitimate application data');
});

it('supports an exclusive new child under an owned private parent', async () => {
  const e = await f.setup(); const request = { ...e.request, root: join(e.root, 'new-child') };
  const result = await provisionFreshInstallation(request, e.context); expect(result.status).toBe('created');
});

it.each(['policy', 'manifest', 'image', 'origin'] as const)('rejects changed admitted request on ready replay: %s', async field => {
  const e = await f.setup(); await provisionFreshInstallation(e.request, e.context);
  const request = structuredClone(e.request);
  if (field === 'policy') request.agentPolicy.maxConcurrent = 1;
  if (field === 'manifest') request.engine.manifest.engineVersion = 'changed';
  if (field === 'image') Object.assign(request, { engineImage: 'different:v2' });
  if (field === 'origin') Object.assign(request, { externalOrigin: 'https://different.invalid' });
  await expect(provisionFreshInstallation(request, e.context)).rejects.toMatchObject({ code: 'recovery_required' });
});

it.each(['config', 'receipt', 'missing', 'partial', 'unknown-config', 'unknown-root'] as const)('refuses changed or interrupted custody: %s', async cause => {
  const e = await f.setup(); const result = await provisionFreshInstallation(e.request, e.context);
  if (cause === 'config') await writeFile(result.paths.agent, '{}', { mode: 0o600 });
  if (cause === 'receipt') await writeFile(result.paths.receipt, '{"private-canary":"do not expose"}', { mode: 0o600 });
  if (cause === 'missing') await rm(join(e.root, 'agent/journal/journal.sqlite'));
  if (cause === 'partial') { const receipt = await json(result.paths.receipt); receipt.phase = 'initializing'; await writeFile(result.paths.receipt, JSON.stringify(receipt)); }
  if (cause === 'unknown-config') await writeFile(join(e.root, 'config/foreign'), 'x', { mode: 0o600 });
  if (cause === 'unknown-root') await writeFile(join(e.root, 'foreign'), 'x', { mode: 0o600 });
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'recovery_required' });
});

it.each(['root-mode', 'root-symlink', 'token-symlink', 'token-hardlink', 'journal-hardlink', 'directory-symlink'] as const)('refuses unsafe paths and links: %s', async cause => {
  const e = await f.setup(); const result = await provisionFreshInstallation(e.request, e.context);
  if (cause === 'root-mode') await chmod(e.root, 0o755);
  if (cause === 'root-symlink') { await rename(e.root, e.root + '-real'); await symlink(e.root + '-real', e.root); }
  if (cause === 'token-symlink') { await rename(join(e.root, 'config/agent-token'), join(e.root, 'config/token-real')); await symlink(join(e.root, 'config/token-real'), join(e.root, 'config/agent-token')); }
  if (cause === 'token-hardlink') await link(join(e.root, 'config/agent-token'), join(e.root, 'backend/token-alias'));
  if (cause === 'journal-hardlink') await link(join(result.paths.agentJournal, 'journal.sqlite'), join(e.root, 'backend/journal-alias'));
  if (cause === 'directory-symlink') { await rename(result.paths.agentStaging, result.paths.agentStaging + '-real'); await symlink(result.paths.agentStaging + '-real', result.paths.agentStaging); }
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toBeInstanceOf(ProvisionError);
  if (cause === 'root-symlink') { await rm(e.root); await rename(e.root + '-real', e.root); }
});

it('refuses active serving gate without takeover and keeps authority intact', async () => {
  const e = await f.setup(); const result = await provisionFreshInstallation(e.request, e.context);
  const gate = openServingState(join(result.paths.agentJournal, 'journal.sqlite.authority.sqlite'));
  try { await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'conflict' }); }
  finally { gate.close(); }
  expect((await provisionFreshInstallation(e.request, e.context)).status).toBe('unchanged');
});

it.each(['architecture', 'network', 'daemon', 'environment', 'image', 'schema', 'policy'] as const)('rejects invalid facts or incompatible caller configuration: %s', async cause => {
  const e = await f.setup();
  if (cause === 'schema') e.request.engine.manifest.schemas.config = 'https://synthetic.invalid/wrong-schema';
  if (cause === 'policy') e.request.agentPolicy.maxConcurrent = 100;
  const mutate = (body: Record<string, unknown>, path: string) => {
    if (cause === 'architecture' && path.includes('images')) body.Architecture = 'amd64';
    if (cause === 'network' && path.includes('networks')) body.Name = 'wrong';
    if (cause === 'daemon' && path.endsWith('/info')) body.ID = 'contains/private/canary';
    if (cause === 'image' && path.includes('images')) body.Id = 'mutable-tag';
    if (cause === 'environment') body.Config = { Env: ['A=1', 'A=2'] };
  };
  const context = { ...e.context, docker: { async request(input: Parameters<typeof f.response>[0]) {
    const result = f.response(input);
    if (!result.ok) return result;
    const body = result.body as Record<string, unknown>;
    mutate(body, input.path);
    return result;
  } } };
  await expect(provisionFreshInstallation(e.request, context)).rejects.toBeInstanceOf(ProvisionError);
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
});

it('captures request, callback and worker URL before the first asynchronous original', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>();
  const original = native.lstat;
  vi.spyOn(native, 'lstat').mockImplementationOnce(async (...args: Parameters<typeof original>) => { entered.resolve(); await release.promise; return original(...args); });
  const pending = provisionFreshInstallation(e.request, e.context); await entered.promise;
  const before = structuredClone(e.request.installationValues);
  e.request.installationValues.retention = { mode: 'enabled', ageDays: 10 };
  e.request.agentPolicy.maxConcurrent = 100; e.context.agentWorkerUrl.pathname = '/should-not-be-used.js';
  e.context.docker.request = async () => { throw new Error('mutated capability'); };
  release.resolve(); const result = await pending;
  expect((await json(result.paths.installation)).values).toEqual(before); expect(e.calls).toHaveLength(4);
});

it('waits a held inspection original through abort and preserves initializing receipt', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>(); let settled = false;
  const context = { ...e.context, docker: { async request(input: Parameters<typeof f.response>[0]) { entered.resolve(); await release.promise; return f.response(input); } } };
  const pending = provisionFreshInstallation(e.request, context).finally(() => { settled = true; });
  const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await entered.promise; e.controller.abort(); await later(); expect(settled).toBe(false);
  release.resolve(); await outcome; expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
  await expect(provisionFreshInstallation(e.request, { ...e.context, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'recovery_required' });
});

it('waits a held native write through abort and never publishes ready', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>(); let settled = false;
  const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('config/agent.json')) {
      const write = handle.write.bind(handle);
      vi.spyOn(handle, 'write').mockImplementationOnce(async (...writeArgs: Parameters<FileHandle['write']>) => {
        entered.resolve(); await release.promise; return write(...writeArgs);
      });
    }
    return handle;
  });
  const pending = provisionFreshInstallation(e.request, e.context).finally(() => { settled = true; });
  const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await entered.promise; e.controller.abort(); await later(); expect(settled).toBe(false); release.resolve(); await outcome;
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
});

it('handles short writes and rejects nonprogress without fake success', async () => {
  const e = await f.setup(); const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('config/agent.json')) {
      const write = handle.write.bind(handle);
      vi.spyOn(handle, 'write').mockImplementationOnce((async (buffer: Uint8Array, offset: number, length: number, position: number) => write(buffer, offset, Math.min(length, 7), position)) as FileHandle['write']);
    }
    return handle;
  });
  expect((await provisionFreshInstallation(e.request, e.context)).status).toBe('created');
});



it('enforces fixed deadlines, bounded closed JSON and input ownership before effects', async () => {
  const e = await f.setup();
  await expect(provisionFreshInstallation(e.request, { ...e.context, deadline: performance.now() - 1 })).rejects.toMatchObject({ code: 'deadline' });
  await expect(provisionFreshInstallation(e.request, { ...e.context, deadline: performance.now() + 60000 })).rejects.toMatchObject({ code: 'invalid_input' });
  for (const extra of [{ unknown: true }, { root: '/tmp/../bad' }, { uid: 0 }, { agentImage: 'x?unbounded' }, { externalOrigin: 'https://user:canary@synthetic.invalid' }]) {
    await expect(provisionFreshInstallation({ ...e.request, ...extra }, e.context)).rejects.toMatchObject({ code: 'invalid_input' });
  }
  const getter = { ...e.request }; Object.defineProperty(getter, 'root', { enumerable: true, get() { throw new Error('Must not execute accessor'); } });
  await expect(provisionFreshInstallation(getter, e.context)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(provisionFreshInstallation({ ...e.request, agentImage: 'a'.repeat(300000) }, e.context)).rejects.toMatchObject({ code: 'invalid_input' });
});

it('CLI strictly bounds arguments and request files and redacts all errors', async () => {
  const e = await f.setup(); const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true); const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  expect(await runCli(['--request', '/tmp/x'])).toBe(2);
  expect(await runCli(['--request', '/tmp/x', '--request', '/tmp/y', '--backend-worker', '/tmp/z'])).toBe(2);
  const requestPath = join(e.root, 'private-request.json');
  await writeFile(requestPath, JSON.stringify({ canary: 'PRIVATE_SECRET_CANARY' }), { mode: 0o600 });
  const args = ['--request', requestPath, '--agent-worker', '/tmp/worker.js', '--backend-worker', '/tmp/backend.js'];
  expect(await runCli(args)).toBe(1);
  await writeFile(requestPath, 'PRIVATE_SECRET_CANARY'.repeat(20000)); expect(await runCli(args)).toBe(1);
  await chmod(requestPath, 0o644); expect(await runCli(args)).toBe(1);
  expect(stdout).not.toHaveBeenCalled();
  for (const call of stderr.mock.calls) expect(['invalid_input\n', 'unsafe_root\n']).toContain(call[0]);
  expect(process.listenerCount('SIGINT')).toBe(0); expect(process.listenerCount('SIGTERM')).toBe(0);
});

it('CLI emits only bounded result JSON and removes signal handlers after actual provisioning', async () => {
  const e = await f.setup(); const requestPath = join(e.root, 'request.json');
  await writeFile(requestPath, JSON.stringify({ ...e.request, root: join(e.root, 'installation') }), { mode: 0o600 });
  vi.spyOn(UnixDockerTransport.prototype, 'request').mockImplementation(async input => f.response(input));
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(await runCli(['--request', requestPath, '--agent-worker', fileURLToPath(f.worker()), '--backend-worker', fileURLToPath(f.worker())])).toBe(0);
  expect(stderr).not.toHaveBeenCalled(); expect(stdout).toHaveBeenCalledOnce();
  const result = JSON.parse(String(stdout.mock.calls[0]![0])) as Record<string, unknown>;
  expect(Object.keys(result).sort()).toEqual(['installationId', 'paths', 'status']); expect(result.status).toBe('created');
  expect(process.listenerCount('SIGINT')).toBe(0); expect(process.listenerCount('SIGTERM')).toBe(0);
});

it('waits issued actual Journal configuration after cancellation and refuses ready publication', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>(); let settled = false;
  const original = Journal.prototype.admission;
  vi.spyOn(Journal.prototype, 'admission').mockImplementationOnce(async function (this: Journal, input) {
    entered.resolve(); await release.promise; return original.call(this, input);
  });
  const pending = provisionFreshInstallation(e.request, e.context).then(() => 'unexpected success', error => error as ProvisionError).finally(() => { settled = true; });
  await entered.promise; e.controller.abort(); await later(); expect(settled).toBe(false); release.resolve();
  expect(await pending).toMatchObject({ code: 'cancelled' });
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
});



it('rejects zero-progress writes without publishing ready', async () => {
  const e = await f.setup(); const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('config/agent.json')) {
      vi.spyOn(handle, 'write').mockImplementationOnce((async (buffer: Uint8Array) => ({ bytesWritten: 0, buffer })) as FileHandle['write']);
    }
    return handle;
  });
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'io' });
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
});

it.each(['missing-gate', 'receipt-authority', 'unknown-receipt-field'] as const)('refuses missing or changed ready authority: %s', async cause => {
  const e = await f.setup(); const result = await provisionFreshInstallation(e.request, e.context);
  if (cause === 'missing-gate') await rm(join(result.paths.agentJournal, 'journal.sqlite.authority.sqlite'));
  else {
    const receipt = await json(result.paths.receipt);
    if (cause === 'receipt-authority') receipt.authority = '00000000-0000-4000-8000-000000000001';
    else receipt.foreign = 'synthetic unknown';
    await writeFile(result.paths.receipt, JSON.stringify(receipt));
  }
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'recovery_required' });
});

it('keeps one root owner while an inspection original is held and does not reset its deadline', async () => {
  const e = await f.setup(); const entered = deferred<void>(); const release = deferred<void>();
  const context = { ...e.context, deadline: performance.now() + 150, docker: { async request(input: Parameters<typeof f.response>[0]) {
    entered.resolve(); await release.promise; return f.response(input);
  } } };
  const pending = provisionFreshInstallation(e.request, context).then(() => 'unexpected success', error => error as ProvisionError);
  await entered.promise;
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'conflict' });
  await new Promise(resolve => setTimeout(resolve, 160)); release.resolve();
  expect(await pending).toMatchObject({ code: 'deadline' });
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('initializing');
});

it('waits an issued original read through cancellation and closes before rejection', async () => {
  const e = await f.setup(); const result = await provisionFreshInstallation(e.request, e.context);
  const entered = deferred<void>(); const release = deferred<void>(); let settled = false; let closed = false;
  const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]) === result.paths.receipt) {
      const read = handle.read.bind(handle); const close = handle.close.bind(handle);
      vi.spyOn(handle, 'read').mockImplementationOnce(async (...readArgs: Parameters<FileHandle['read']>) => {
        entered.resolve(); await release.promise; return read(...readArgs);
      });
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); closed = true; });
    }
    return handle;
  });
  const pending = provisionFreshInstallation(e.request, e.context).then(() => 'unexpected success', error => error as ProvisionError).finally(() => { settled = true; });
  await entered.promise; e.controller.abort(); await later(); expect(settled).toBe(false); expect(closed).toBe(false);
  release.resolve(); expect(await pending).toMatchObject({ code: 'cancelled' }); expect(closed).toBe(true);
});

it('rejects interrupted final commit and fully revalidates and re-syncs ready replay', async () => {
  const e = await f.setup(); const original = native.open; let rootOpens = 0;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]) === e.root && ++rootOpens === 2) vi.spyOn(handle, 'sync').mockRejectedValue(new Error('synthetic final commit sync failure'));
    return handle;
  });
  await expect(provisionFreshInstallation(e.request, e.context)).rejects.toMatchObject({ code: 'io' });
  expect((await json(join(e.root, 'installation.json'))).phase).toBe('ready');
  vi.restoreAllMocks();
  expect((await provisionFreshInstallation(e.request, e.context)).status).toBe('unchanged');
});

it.each(['engine-tag', 'agent-tag', 'daemon'] as const)('R1 refuses changed inspected pins with the same request: %s', async change => {
  const e = await f.setup(); await provisionFreshInstallation(e.request, e.context);
  const token = await readFile(join(e.root, 'config/agent-token'));
  const context = { ...e.context, docker: { async request(input: Parameters<typeof f.response>[0]) {
    const result = f.response(input); if (!result.ok) return result;
    const body = result.body as Record<string, unknown>;
    if (change === 'engine-tag' && input.path.includes('synthetic-engine')) body.Id = 'sha256:' + 'd'.repeat(64);
    if (change === 'agent-tag' && input.path.includes('synthetic-agent')) body.Id = 'sha256:' + 'd'.repeat(64);
    if (change === 'daemon' && input.path.endsWith('/info')) body.ID = 'different-valid-daemon';
    return result;
  } } };
  await expect(provisionFreshInstallation(e.request, context)).rejects.toMatchObject({ code: 'recovery_required' });
  expect(await readFile(join(e.root, 'config/agent-token'))).toEqual(token);
});

it('R1 bounds process admission across different roots while an original remains outstanding', async () => {
  const first = await f.setup(); const second = await f.setup();
  const entered = deferred<void>(); const release = deferred<void>();
  const pending = provisionFreshInstallation(first.request, { ...first.context, docker: { async request(input: Parameters<typeof f.response>[0]) {
    entered.resolve(); await release.promise; return f.response(input);
  } } }).then(() => 'unexpected success', error => error as ProvisionError);
  await entered.promise;
  await expect(provisionFreshInstallation(second.request, second.context)).rejects.toMatchObject({ code: 'conflict' });
  first.controller.abort(); release.resolve(); expect(await pending).toMatchObject({ code: 'cancelled' });
  expect((await provisionFreshInstallation(second.request, second.context)).status).toBe('created');
});
