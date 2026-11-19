import { expect, it, vi, afterEach } from 'vitest';
import { bytes, artifact, input, reader, report } from './fixtures.js';
afterEach(() => vi.restoreAllMocks());
it('verifies actual byte/hash metadata before returning bounded UTF-8 plain text', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes));
  expect(await reader().read(input())).toBe(report);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/artifacts/${artifact.artifactId}/content`),
    expect.objectContaining({credentials: 'same-origin', redirect: 'error', cache: 'no-store'}));
});
it('rejects oversized or other-kind descriptors before issuing a request', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch'); const reads = reader();
  for (const patch of [{bytes: 262145}, {kind: 'target-runtime'}, {artifactId: '00000000-0000-4000-8000-000000000009'}]) {
    await expect(reads.read({...input(), artifact: {...artifact, ...patch}})).rejects.toThrow('selection');
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects malformed UTF-8 even when the body length and verified hash agree', async () => {
  const body = new Uint8Array([0xc3, 0x28]);
  const reads = reader({fetch: async () => new Response(body), monotonic: () => 0, digest: async () => 'a'.repeat(64)});
  await expect(reads.read({...input(), artifact: {...artifact, bytes: 2, sha256: 'a'.repeat(64)}})).rejects.toThrow();
});
it('shares two whole-operation credits while serializing target/report wires and retaining ignored aborts', async () => {
  const {fixture: targetFixture} = await import('../target-observations/read-fixtures.js');
  const {deferred} = await import('./fixtures.js');
  const holds = [deferred<Response>(), deferred<Response>()]; const issued = [deferred<void>(), deferred<void>()];
  const target = targetFixture({fetch: async () => {issued[0]!.resolve(); return holds[0]!.promise;}});
  const selected = input(); const controller = new AbortController();
  let secondIssued = false;
  const reads = reader({fetch: async () => {secondIssued = true; issued[1]!.resolve(); return holds[1]!.promise;},
    digest: async () => artifact.sha256, monotonic: () => 0});
  const first = target.reads.read(target.input); const firstRejected = expect(first).rejects.toThrow();
  const second = reads.read({...selected, signal: controller.signal}); const secondRejected = expect(second).rejects.toThrow();
  await issued[0]!.promise;
  try {
    expect(secondIssued).toBe(false);
    await expect(reader().read(input())).rejects.toThrow('capacity');
    target.controller.abort();
    await expect(reader().read(input())).rejects.toThrow('capacity');
    holds[0]!.resolve(new Response(target.bytes)); await firstRejected;
    await issued[1]!.promise; controller.abort();
  } finally {
    holds[0]!.resolve(new Response(target.bytes)); holds[1]!.resolve(new Response(bytes));
    await Promise.all([firstRejected, secondRejected]);
  }
  expect(await reader({fetch: async () => new Response(bytes), digest: async () => artifact.sha256, monotonic: () => 0}).read(input())).toBe(report);
});
