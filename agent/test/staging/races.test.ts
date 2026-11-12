import { expect, it } from 'vitest';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scope, now } from '../admission/fixtures.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import { data, fixture, operation, stream } from './fixtures.js';

const f = fixture();
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
it('freezes independent scoped authority before provider callbacks and caller mutations', async () => {
  const e = await f.environment(); let frozen = false;
  const stager = e.create({ providers: { ...e.options.providers, input: async request => {
    frozen = Object.isFrozen(request) && Object.isFrozen(request.authority) && Object.isFrozen(request.input);
    expect(() => { (request.authority as { generation: number }).generation = 9; }).toThrow();
    expect(() => { (request.input as { bytes: number }).bytes = 999; }).toThrow();
    return stream();
  } } });
  const key = scope(e.offer); const task = stager.prepare({ key, operation: operation() });
  key.generation = 42;
  const result = await task.result; await task.quiesced;
  expect(result.ok).toBe(true); expect(frozen).toBe(true);
});
it.each(['cancel', 'deadline', 'clock', 'claim', 'released'])('rejects %s state before any task write', async kind => {
  const e = await f.environment();
  const mutations: Record<string, () => Promise<unknown>> = {
    cancel: () => e.owner.durableCancel(scope(e.offer)),
    clock: async () => { await e.owner.supervision({ key: scope(e.offer), now: now + 10 }); },
    claim: () => e.owner.admission({ kind: 'claimCreate', key: scope(e.offer), specDigest: 'd'.repeat(64) }),
    released: () => e.owner.admission({ kind: 'abortUnstarted', key: scope(e.offer) }),
    deadline: async () => undefined,
  };
  await mutations[kind]!();
  const task = e.prepare(e.create(kind === 'deadline' ? { wallNow: () => now + 1000 } : {}));
  expect((await task.result).ok).toBe(false); await task.quiesced;
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
});
it('durable cancellation during a provider callback prevents its first input write', async () => {
  const e = await f.environment();
  const task = e.prepare(e.create({ providers: { ...e.options.providers, input: async () => {
    await e.owner.durableCancel(scope(e.offer)); return stream();
  } } }));
  expect(await task.result).toEqual({ ok: false, reason: 'cancelled' }); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  expect(await readdir(join(e.rootPath, name, 'input'))).toEqual([]);
});
it('wall deadline or backwards clock during a provider callback prevents further writes', async () => {
  for (const clock of [now + 1000, now]) {
    const e = await f.environment(); let wall = now + 1;
    const task = e.prepare(e.create({ wallNow: () => wall, providers: { ...e.options.providers, input: async () => { wall = clock; return stream(); } } }));
    expect(await task.result).toEqual({ ok: false, reason: clock === now ? 'clock_fenced' : 'deadline' }); await task.quiesced;
    const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
    expect(await readdir(join(e.rootPath, name, 'input'))).toEqual([]);
  }
});
it('returns aborted failure promptly, holds both slots and close until late providers quiesce', async () => {
  const environments = [await f.environment(), await f.environment(), await f.environment()];
  const started = [deferred<void>(), deferred<void>()];
  const sources = [deferred<AsyncIterable<Uint8Array>>(), deferred<AsyncIterable<Uint8Array>>()];
  const controllers = [new AbortController(), new AbortController()];
  const stagers = environments.map((e, index) => e.create(index < 2 ? { providers: { ...e.options.providers, input: async () => {
    started[index]!.resolve(); return sources[index]!.promise;
  } } } : {}));
  const tasks = environments.slice(0, 2).map((e, index) => stagers[index]!.prepare({ key: scope(e.offer), operation: { ...operation(), signal: controllers[index]!.signal } }));
  await Promise.all(started.map(start => start.promise));
  expect(await environments[2]!.prepare(stagers[2]!).result).toEqual({ ok: false, reason: 'busy' });
  controllers.forEach(controller => controller.abort());
  expect(await Promise.all(tasks.map(task => task.result))).toEqual([{ ok: false, reason: 'cancelled' }, { ok: false, reason: 'cancelled' }]);
  let closed = false; const close = stagers[0]!.close().then(() => { closed = true; });
  expect(closed).toBe(false);
  expect(await environments[2]!.prepare(stagers[2]!).result).toEqual({ ok: false, reason: 'busy' });
  sources.forEach(source => source.resolve(stream()));
  await Promise.all(tasks.map(task => task.quiesced)); await close;
  expect(closed).toBe(true);
  expect(await environments[0]!.prepare(stagers[0]!).result).toEqual({ ok: false, reason: 'closed' });
  const next = environments[2]!.prepare(stagers[2]!); expect((await next.result).ok).toBe(true); await next.quiesced;
});
it('retains a stalled iterator slot until next and iterator return settle, without late writes', async () => {
  const e = await f.environment(); const started = deferred<void>(); const late = deferred<IteratorResult<Uint8Array>>();
  let returned = false;
  const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
    next: () => { started.resolve(); return late.promise; },
    return: async () => { returned = true; return { done: true, value: undefined }; },
  }) };
  const controller = new AbortController();
  const stager = e.create({ providers: { ...e.options.providers, input: async () => source } });
  const task = stager.prepare({ key: scope(e.offer), operation: { ...operation(), signal: controller.signal } });
  await started.promise; controller.abort();
  expect(await task.result).toEqual({ ok: false, reason: 'cancelled' });
  let quiesced = false; void task.quiesced.then(() => { quiesced = true; });
  expect(quiesced).toBe(false); expect(returned).toBe(false);
  late.resolve({ done: false, value: data }); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  expect((await lstat(join(e.rootPath, name, 'input/input-000.bin'))).size).toBe(0);
  expect(returned).toBe(true);
});
it('monotonic timeout fences a stalled provider even when wall time remains fixed', async () => {
  const e = await f.environment(); const started = deferred<void>(); const source = deferred<AsyncIterable<Uint8Array>>();
  const stager = e.create({ providers: { ...e.options.providers, input: async () => { started.resolve(); return source.promise; } } });
  const task = e.prepare(stager, e.offer, 250);
  await started.promise;
  expect(await task.result).toEqual({ ok: false, reason: 'deadline' });
  let done = false; void task.quiesced.then(() => { done = true; }); expect(done).toBe(false);
  source.resolve(stream()); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  expect(await readdir(join(e.rootPath, name, 'input'))).toEqual([]);
});
