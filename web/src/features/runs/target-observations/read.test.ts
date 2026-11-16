import { afterEach, expect, it, vi } from 'vitest';
import { TARGET_RUNTIME_REPORT_BYTES } from '@beetle/contracts/target-runtime';
import { TargetReportReads } from './read.js';
import { deferred, fixture, hash, report } from './read-fixtures.js';
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});
it('reads only the scoped ID route and verifies exact bytes/hash before decoding', async () => {
  const f = fixture(); expect(await f.reads.read(f.input)).toEqual(report());
  expect(f.fetch).toHaveBeenCalledWith(expect.stringContaining(`/runs/${f.params.runId}/attempts/${f.params.attemptId}/artifacts/${f.params.artifactId}/content`),
    expect.objectContaining({credentials: 'same-origin', redirect: 'error', cache: 'no-store'}));
  expect(f.digest).toHaveBeenCalledTimes(1);
});
it('refuses invalid metadata and retired same-turn reads before fetch', async () => {
  const f = fixture();
  for (const artifact of [{...f.artifact, bytes: TARGET_RUNTIME_REPORT_BYTES + 1}, {...f.artifact, kind: 'other'},
    {...f.artifact, artifactId: f.params.runId}]) await expect(f.reads.read({...f.input, artifact})).rejects.toThrow();
  const pending = f.reads.read(f.input); f.controller.abort(); await expect(pending).rejects.toThrow(); expect(f.fetch).not.toHaveBeenCalled();
});
it('does not accept a dishonest header, oversized stream or mismatched digest', async () => {
  const f = fixture(); let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array(f.bytes.length + 1));}, cancel() {cancelled = true;}});
  f.fetch.mockResolvedValueOnce(new Response(oversized, {status: 200, headers: {'content-length': String(f.bytes.length)}}));
  await expect(f.reads.read(f.input)).rejects.toThrow(); expect(cancelled).toBe(true); expect(f.digest).not.toHaveBeenCalled();
  f.fetch.mockResolvedValueOnce(new Response(f.bytes, {status: 200, headers: {'content-length': '1'}}));
  await expect(f.reads.read(f.input)).rejects.toThrow(); expect(f.digest).not.toHaveBeenCalled();
  await expect(f.reads.read({...f.input, artifact: {...f.artifact, sha256: 'a'.repeat(64)}})).rejects.toThrow('integrity');
});
it('retains aborted fetch originals under two shared credits without queued retries', async () => {
  const holds = [deferred<Response>(), deferred<Response>()]; let index = 0; const issued = deferred<void>();
  const f = fixture({fetch: async () => {const hold = holds[index++]!; issued.resolve(); return hold.promise;}});
  const first = f.reads.read(f.input); await issued.promise; f.controller.abort();
  const firstDone = first.then(() => true, () => true); let done = false; void firstDone.then(() => {done = true;});
  const second = f.reads.read({...f.input, signal: new AbortController().signal}); await Promise.resolve();
  await expect(f.reads.read({...f.input, signal: new AbortController().signal})).rejects.toThrow('capacity'); expect(done).toBe(false);
  holds[0]!.resolve(new Response(f.bytes)); holds[1]!.resolve(new Response(f.bytes));
  await expect(first).rejects.toThrow(); expect(await second).toEqual(report()); expect(index).toBe(2);
});
it('waits for body cancellation original and does not refund on the abort hint', async () => {
  const cancel = deferred<void>(); const issued = deferred<void>(); const cancelIssued = deferred<void>();
  const stream = new ReadableStream<Uint8Array>({start() {issued.resolve();}, cancel() {cancelIssued.resolve(); return cancel.promise;}});
  const f = fixture({fetch: async () => new Response(stream)});
  const pending = f.reads.read(f.input); let done = false; void pending.then(() => {done = true;}, () => {done = true;});
  await issued.promise; for (let count = 0; count < 10; count++) await Promise.resolve(); f.controller.abort(); await cancelIssued.promise;
  expect(done).toBe(false); cancel.resolve(); await expect(pending).rejects.toThrow();
});
it('retains an uncancellable hash original and rejects its late completion after retirement', async () => {
  const held = deferred<string>(); const issued = deferred<void>();
  const f = fixture({digest: async () => {issued.resolve(); return held.promise;}});
  const pending = f.reads.read(f.input); await issued.promise; f.controller.abort();
  let done = false; void pending.then(() => {done = true;}, () => {done = true;}); await Promise.resolve(); expect(done).toBe(false);
  held.resolve(hash(f.bytes)); await expect(pending).rejects.toThrow();
});
it('enforces the whole-read deadline even if its timer has not run', async () => {
  let now = 0; const f = fixture({monotonic: () => now, digest: async bytes => {now = 5000; return hash(bytes);}});
  await expect(f.reads.read(f.input)).rejects.toThrow('expired');
});
it('rejects malformed report content even when its bytes and digest match metadata', async () => {
  const f = fixture(); const bytes = new TextEncoder().encode('{"version":2}'); f.fetch.mockResolvedValue(new Response(bytes));
  await expect(f.reads.read({...f.input, artifact: {...f.artifact, bytes: bytes.length, sha256: hash(bytes)}})).rejects.toThrow();
});

it('bounds stream fragment work independently of the declared byte count', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({pull(controller) {controller.enqueue(new Uint8Array(0));}, cancel() {cancelled = true;}});
  const f = fixture({fetch: async () => new Response(body)});
  await expect(f.reads.read(f.input)).rejects.toThrow('limit'); expect(cancelled).toBe(true); expect(f.digest).not.toHaveBeenCalled();
});

it('verifies the fixed fixture through the native WebCrypto digest', async () => {
  const f = fixture(); vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(f.bytes));
  expect(await new TargetReportReads().read(f.input)).toEqual(report());
});
