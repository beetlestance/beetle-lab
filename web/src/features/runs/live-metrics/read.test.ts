import { afterEach, expect, it, vi } from 'vitest';
import { deferred, digest, fixture, frame } from './fixtures.js';
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});
it('reads the fixed same-origin route and verifies actual WebCrypto subset/body digests', async () => {
  const f = fixture(); const value = await f.reads.read(f.input);
  expect(value.frame).toEqual(f.value()); expect(value.expiresAtMono).toBe(6000); expect(value.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(f.fetch).toHaveBeenCalledWith(expect.stringContaining(`/runs/${f.params.runId}/attempts/${f.params.attemptId}/metrics/live`),
    expect.objectContaining({credentials: 'same-origin', cache: 'no-store', redirect: 'error'}));
  expect(f.digest).toHaveBeenCalledTimes(2);
});
it('validates selection and fences a same-turn retired read before fetch', async () => {
  const f = fixture();
  await expect(f.reads.read({...f.input, params: {...f.params, attemptId: '../secrets'}})).rejects.toThrow();
  const read = f.reads.read(f.input); f.controller.abort(); await expect(read).rejects.toThrow(); expect(f.fetch).not.toHaveBeenCalled();
});
it.each(['scope', 'digest', 'stale', 'future'] as const)('rejects an unsafe live frame: %s', async cause => {
  const f = fixture(); const value = frame();
  if (cause === 'scope') value.scope.workspaceId = f.params.runId;
  if (cause === 'digest') value.subsetDigest = 'f'.repeat(64);
  if (cause === 'stale') f.clock(8000);
  if (cause === 'future') f.clock(999);
  f.set(value); await expect(f.reads.read(f.input)).rejects.toThrow();
});
it.each(['length', 'growth', 'fragments', 'utf8', 'type', 'redirect'] as const)('bounds live response bodies: %s', async cause => {
  const f = fixture();
  f.fetch.mockImplementationOnce(async () => {
    if (cause === 'length') return new Response('{}', {headers: {'content-type': 'application/json', 'content-length': '65537'}});
    if (cause === 'growth') return new Response('x'.repeat(65537), {headers: {'content-type': 'application/json'}});
    if (cause === 'utf8') return new Response(new Uint8Array([0xc0, 0xaf]), {headers: {'content-type': 'application/json'}});
    if (cause === 'type') return new Response('{}', {headers: {'content-type': 'text/html'}});
    if (cause === 'redirect') return new Response('{}', {status: 302, headers: {'content-type': 'application/json'}});
    return new Response(new ReadableStream({start(controller) {for (let i = 0; i < 4097; i++) controller.enqueue(new Uint8Array()); controller.close();}}),
      {headers: {'content-type': 'application/json'}});
  });
  await expect(f.reads.read(f.input)).rejects.toThrow();
});
it('retains both ignored-abort fetch originals and cancels their late bodies before releasing slots', async () => {
  const first = deferred<Response>(); const second = deferred<Response>(); const f = fixture();
  f.fetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const a = f.reads.read(f.input); const b = f.reads.read(f.input);
  const failures = [expect(a).rejects.toThrow(), expect(b).rejects.toThrow()];
  await Promise.resolve(); f.controller.abort();
  await expect(f.reads.read({...f.input, signal: new AbortController().signal})).rejects.toThrow();
  const cancel = deferred<void>(); let cancelled = 0;
  const late = () => new Response(new ReadableStream({cancel() {cancelled++; return cancel.promise;}}));
  first.resolve(late()); second.resolve(late());
  await expect.poll(() => cancelled).toBe(2);
  await expect(f.reads.read({...f.input, signal: new AbortController().signal})).rejects.toThrow();
  cancel.resolve(); await Promise.all(failures);
  expect((await f.reads.read({...f.input, signal: new AbortController().signal})).frame).toEqual(f.value());
});
it('retains an original hash through abort and rejects its late success', async () => {
  const gate = deferred<string>(); const f = fixture(); f.digest.mockImplementationOnce(() => gate.promise);
  const read = f.reads.read(f.input); const failure = expect(read).rejects.toThrow();
  await expect.poll(() => f.digest.mock.calls.length).toBe(1); f.controller.abort();
  let settled = false; void read.catch(() => {settled = true;}); await Promise.resolve(); expect(settled).toBe(false);
  gate.resolve(await digest(f.digest.mock.calls[0]![0])); await failure;
});
it('includes hashing in its five-second budget and rejects wall/monotonic rollback', async () => {
  const f = fixture(); f.digest.mockImplementationOnce(async bytes => {f.clock(1000, 5000); return digest(bytes);});
  await expect(f.reads.read(f.input)).rejects.toThrow();
  const rollback = fixture(); rollback.fetch.mockImplementationOnce(async () => {
    rollback.clock(999); return new Response(JSON.stringify(rollback.value()), {headers: {'content-type': 'application/json'}});
  });
  await expect(rollback.reads.read(rollback.input)).rejects.toThrow();
});
