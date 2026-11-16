import { afterEach, expect, it, vi } from 'vitest';
import { createResourceObserver } from '../../src/observation/index.js';
import type { ResourceObserver } from '../../src/observation/index.js';
import type { DockerReply, DockerTransport } from '../../src/backends/docker/index.js';
import { effectivePool, addResources } from '../../src/admission/index.js';
import { fixture, operation } from '../staging/fixtures.js';
import { configuration, now, observation } from '../admission/fixtures.js';

const f = fixture(); const observers: ResourceObserver[] = [];
const releases: (() => void)[] = [];
const version: DockerReply = { ok: true, status: 200, body: { MinAPIVersion: '1.24', ApiVersion: '1.47' } };
const info: DockerReply = { ok: true, status: 200, body: { ID: 'synthetic-daemon', OSType: 'linux', KernelVersion: '6.6.0',
  NCPU: 14, MemTotal: 16 * 1024 ** 3, MemoryLimit: true, SwapLimit: true, CpuCfsPeriod: true, CpuCfsQuota: true, PidsLimit: true } };
function transport(): DockerTransport {
  return { request: vi.fn(async input => input.path === '/version' ? version : info) };
}
async function setup(port = transport(), wallNow: () => number = () => now + 1) {
  const e = await f.environment(false); const config = configuration();
  const observer = createResourceObserver({ root: e.options.root, transport: port, configuration: config, wallNow });
  observers.push(observer); return { e, observer, config, port };
}
function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.all(observers.splice(0).map(observer => observer.close()));
});

it('reads actual root space and pinned daemon evidence with explicit configured policies and no guard invention', async () => {
  const { observer, config, port, e } = await setup(); config.pool.pids = 999;
  const sample = await observer.sample(operation());
  expect(sample).toMatchObject({ source: 'docker-info+statfs', status: 'known', observedAt: now + 1,
    capacity: { cpuMillis: 14000, memoryBytes: 16 * 1024 ** 3, pids: 42, outputBytes: 4000, stagingBytes: 10_000_000 },
    capacityProvenance: { cpuMillis: 'docker-info', memoryBytes: 'docker-info', pids: 'configured-policy',
      outputBytes: 'configured-policy', stagingBytes: 'configured-policy' },
    physicalPidCapacity: null, diskSource: 'statfs', daemonId: 'synthetic-daemon', controls: ['cpu', 'memory', 'pids'] });
  expect(sample.freeDiskBytes).toBeGreaterThan(0); expect(sample).not.toHaveProperty('guards');
  expect(sample).not.toHaveProperty('idle'); expect(sample).not.toHaveProperty('thermal');
  expect(vi.mocked(port.request).mock.calls.map(([request]) => [request.method, request.path]))
    .toEqual([['GET', '/version'], ['GET', '/v1.47/info']]);
  const initial = configuration();
  expect(effectivePool(initial.pool, sample.capacity, addResources(initial.headroom, initial.controlReserve))).toEqual(initial.pool);
  await e.owner.admission({ kind: 'observe', observation: sample });
  expect(await f.enqueue(e.owner, e.offer, now + 1)).toEqual({ kind: 'reject', reason: 'controls_unavailable' });
});

it.each(['cancel', 'deadline'] as const)('retains a held original after%s until sample and close really settle', async mode => {
  const held = hold<DockerReply>(); releases.push(() => held.resolve(version));
  const port = transport(); vi.mocked(port.request).mockReturnValueOnce(held.promise);
  const { observer } = await setup(port); const abort = new AbortController();
  const sample = observer.sample({ ...operation(mode === 'deadline' ? 1000 : 5000), signal: abort.signal });
  await vi.waitFor(() => { expect(port.request).toHaveBeenCalledOnce(); });
  if (mode === 'cancel') abort.abort();
  else await new Promise(resolve => setTimeout(resolve, 1050));
  await expect(observer.sample(operation())).rejects.toMatchObject({ reason: 'busy' });
  let sampled = false; void sample.then(() => { sampled = true; });
  const closing = observer.close(); let closed = false; void closing.then(() => { closed = true; });
  await Promise.resolve(); expect(sampled).toBe(false); expect(closed).toBe(false);
  held.resolve(version);
  expect(await sample).toMatchObject({ status: 'unknown', daemonId: null, controls: [], capacity: { cpuMillis: 0, memoryBytes: 0 } });
  await closing; expect(observer.close()).toBe(closing); expect(port.request).toHaveBeenCalledOnce();
  await expect(observer.sample(operation())).rejects.toMatchObject({ reason: 'closed' });
});

it('returns unknown for foreign daemon or failing transport without copying stale facts', async () => {
  const port = transport(); vi.mocked(port.request).mockRejectedValueOnce(new Error('private-error'));
  const { observer } = await setup(port);
  expect(await observer.sample(operation())).toMatchObject({ status: 'unknown', controls: [], diskSource: 'unavailable' });
  vi.mocked(port.request).mockImplementation(async input => input.path === '/version' ? version
    : { ok: true, status: 200, body: { ...(info as { body: object }).body, ID: 'foreign-daemon' } });
  expect(await observer.sample(operation())).toMatchObject({ status: 'unknown', daemonId: null });
});

it.each(['unknown', 'omitted'] as const)('publishes equal-time%s revocation through actual observer and journal admission', async cause => {
  const { observer, port, e } = await setup();
  const first = await observer.sample(operation());
  await e.owner.admission({ kind: 'observe', observation: { ...first, guards: observation(now + 1).guards! } });
  expect(await f.enqueue(e.owner, e.offer, now + 1)).toEqual({ kind: 'defer', reason: 'queued' });
  if (cause === 'unknown') vi.mocked(port.request).mockRejectedValueOnce(new Error('synthetic-daemon-failure'));
  const revoked = await observer.sample(operation());
  expect(revoked.observedAt).toBe(first.observedAt);
  expect(revoked.status).toBe(cause === 'unknown' ? 'unknown' : 'known');
  expect(await e.owner.admission({ kind: 'observe', observation: revoked })).toEqual({ stored: true });
  expect(await f.admit(e.owner, e.offer, now + 1)).toEqual({ kind: 'defer', reason: 'capacity_unknown' });
});

it('uses the beginning timestamp and refuses invalid or regressing wall time', async () => {
  const reading = vi.fn<() => number>().mockReturnValueOnce(now + 1).mockReturnValueOnce(now + 5).mockReturnValueOnce(now + 4);
  const { observer, port } = await setup(transport(), reading);
  expect(await observer.sample(operation())).toMatchObject({ status: 'known', observedAt: now + 1 });
  expect(await observer.sample(operation())).toMatchObject({ status: 'unknown', controls: [] });
  expect(port.request).toHaveBeenCalledTimes(2);
  reading.mockReturnValue(Number.NaN);
  expect(await observer.sample(operation())).toMatchObject({ status: 'unknown', observedAt: 0 });
});

it('owns shutdown before a trusted wall callback can reenter it', async () => {
  let closing: Promise<void> | undefined;
  const e = await f.environment(false); const port = transport();
  const observer: ResourceObserver = createResourceObserver({ root: e.options.root, configuration: configuration(), transport: port,
    wallNow: () => { closing = observer.close(); return now; } }); observers.push(observer);
  expect(await observer.sample(operation())).toMatchObject({ status: 'unknown' });
  await closing; expect(observer.close()).toBe(closing); expect(port.request).not.toHaveBeenCalled();
});

it('rejects unsafe configured sums and accessor budgets without invoking them', async () => {
  const { e, observer } = await setup(); const config = configuration(); config.pool.pids = Number.MAX_SAFE_INTEGER;
  expect(() => createResourceObserver({ root: e.options.root, transport: transport(), configuration: config })).toThrow('invalid_input');
  let calls = 0;
  await expect(observer.sample({ get deadline() { calls++; return 0; } })).rejects.toMatchObject({ reason: 'invalid_input' });
  expect(calls).toBe(0);
  await expect(observer.sample({ ...operation(), signal: Object.create(AbortSignal.prototype) as AbortSignal }))
    .rejects.toMatchObject({ reason: 'invalid_input' });
});
