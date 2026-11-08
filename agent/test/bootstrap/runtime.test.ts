import { expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sealEngineResult } from '@beetle/contracts';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import type { DockerReply } from '../../src/backends/docker/index.js';
import { payload } from '../backends/docker/fixtures.js';
import { deferred } from '../supervisor/fixtures.js';
import { fixture, digest } from './fixtures.js';
import { scope } from '../admission/fixtures.js';

const f = fixture();
it('owns real services, reports actual clipped capabilities and closes a fresh installation cleanly', async () => {
  const e = await f.setup(); const runtime = f.keep(await openAgentRuntime(e.options));
  expect(await runtime.initial).toEqual({ ready: true }); expect(runtime.status().ready).toBe(true);
  await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  const capabilities = await runtime.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
  expect(capabilities.statusCode).toBe(200); expect(capabilities.json()).toMatchObject({
    capacity: { cpuMillis: 4000, memoryBytes: 4000, pids: 40, outputBytes: 131_072, timeoutMs: 5000 },
    supportedControls: ['cpu', 'memory', 'pids', 'timeout', 'output'], engines: [{ id: 'k6', imageDigest: e.options.catalog.engines[0]!.profile.imageDigest }] });
  const closing = runtime.close(); expect(runtime.close()).toBe(closing); expect(runtime.status().closed).toBe(true);
  await closing;
  const journal = await f.open(e.journalPath); await f.close(journal);
  const reopened = f.keep(await openAgentRuntime(e.options)); expect(await reopened.initial).toEqual({ ready: true }); await reopened.close();
});

it('runs staged execution through actual DockerBackend, private HTTP and the scheduler exactly once', async () => {
  const e = await f.setup(); const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true });
  const path = `/runner/v1/attempts/${e.offer.attemptId}`;
  const accepted = await runtime.server.inject({ method: 'PUT', url: path, headers: e.headers, payload: e.offer });
  expect(accepted.statusCode).toBe(202);
  await vi.waitFor(() => { expect(e.daemon.calls.filter(call => call.path.endsWith('/start'))).toHaveLength(1); }, { timeout: 5000 });
  const original = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  const { seal: _seal, ...body } = original; void _seal;
  const key = { attemptId: e.offer.attemptId, organizationId: e.offer.organizationId, workspaceId: e.offer.workspaceId, generation: 1 };
  const sealed = sealEngineResult({ ...body, ...key, artifacts: [], thresholds: [],
    requiredAssertions: { required: 1, passed: 1, failed: 0, unknown: 0 } }, new Date().toISOString(), digest);
  if (!sealed.ok) throw new Error(sealed.code);
  const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: new Date().toISOString(), payload: sealed.value };
  await writeFile(join(e.output, 'engine-result.json'), JSON.stringify(sealed.value), { mode: 0o600 });
  await writeFile(join(e.output, 'control.ndjson'), JSON.stringify(event) + '\n', { mode: 0o600 });
  e.daemon.state = payload(e.daemon.plan, 'exited');
  await vi.waitFor(async () => {
    const snapshot = await runtime.server.inject({ url: path, headers: e.headers });
    expect(snapshot.json()).toMatchObject({ state: 'exited', result: sealed.value });
    // Wait for the owner to retire, not an intermediate scheduler gap after exit.
    expect(runtime.status()).toMatchObject({ retainedActors: 0, scheduler: { outstanding: 0 } });
  }, { timeout: 5000 });
  await runtime.close();
  const journal = await f.open(e.journalPath);
  expect(await journal.admission({ kind: 'reservation', key })).toMatchObject({ status: 'released' });
  expect(e.daemon.calls.filter(call => call.path.includes('/create?'))).toHaveLength(1);
  expect(e.daemon.calls.filter(call => call.path.endsWith('/start'))).toHaveLength(1);
  expect(e.daemon.calls.some(call => call.method === 'DELETE')).toBe(false);
});

it('drains partially initialized services on invalid credential and permits a fresh owner', async () => {
  const e = await f.setup(); await expect(openAgentRuntime({ ...e.options, credential: 'invalid' })).rejects.toMatchObject({ reason: 'startup' });
  const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true }); await runtime.close();
});

it('retains an aborted original verification before permitting another startup', async () => {
  const e = await f.setup(); const held = deferred<DockerReply>(); const abort = new AbortController();
  const request = vi.fn(() => held.promise);
  const opening = openAgentRuntime({ ...e.options, signal: abort.signal, transport: { request } });
  const rejected = expect(opening).rejects.toMatchObject({ reason: 'startup' });
  await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce(); }); abort.abort();
  await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  held.resolve({ ok: false, reason: 'aborted', dispatched: true }); await rejected;
  const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true }); await runtime.close();
});

it('reports unknown resource evidence without fabricating capabilities or launching queued work', async () => {
  const e = await f.setup();
  const runtime = f.keep(await openAgentRuntime({ ...e.options, transport: { request: async input => input.path === '/version'
    ? { ok: false, reason: 'unavailable', dispatched: false } : e.options.transport.request(input) } }));
  expect(await runtime.initial).toEqual({ ready: false }); expect(runtime.status().ready).toBe(false);
  expect((await runtime.server.inject({ url: '/runner/v1/capabilities', headers: e.headers })).statusCode).toBe(503);
  const response = await runtime.server.inject({ method: 'PUT', url: `/runner/v1/attempts/${e.offer.attemptId}`,
    headers: e.headers, payload: e.offer });
  expect(response.statusCode).toBe(202); await runtime.close();
  const journal = await f.open(e.journalPath);
  await expect(journal.admission({ kind: 'reservation', key: scope(e.offer) })).rejects.toMatchObject({ code: 'not_found' });
  expect(e.daemon.mutations()).toHaveLength(0);
});

it('can drain after listening fails before accepting connections', async () => {
  const e = await f.setup(); const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
  await expect(runtime.server.listen({ host: '127.0.0.1', port: -1 })).rejects.toThrow();
  await runtime.close();
  const reopened = f.keep(await openAgentRuntime(e.options)); expect(await reopened.initial).toEqual({ ready: true }); await reopened.close();
});

it('adopts and closes the original journal worker that becomes ready after startup abort', async () => {
  const e = await f.setup(); const abort = new AbortController();
  const marker = join(e.rootPath, 'worker-started'); const release = join(e.rootPath, 'worker-release');
  const wrapper = join(e.rootPath, 'delayed-worker.mjs');
  await writeFile(wrapper, `import {writeFile,access} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
await writeFile(${JSON.stringify(marker)}, 'started', {mode:384});
for (;;) { try { await access(${JSON.stringify(release)}); break; } catch { await setTimeout(10); } }
await import(${JSON.stringify(f.workerUrl().href)});\n`, { mode: 0o600 });
  const opening = openAgentRuntime({ ...e.options, signal: abort.signal,
    journal: { ...e.options.journal, workerUrl: pathToFileURL(wrapper) } });
  const rejected = expect(opening).rejects.toMatchObject({ reason: 'startup' });
  try {
    await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('started'); }); abort.abort();
    await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  } finally { await writeFile(release, 'release', { mode: 0o600 }); await rejected; }
  const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true }); await runtime.close();
});
