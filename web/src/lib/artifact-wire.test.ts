import { afterEach, expect, it, vi } from 'vitest';
import { deferred, fixture } from '../features/runs/target-observations/read-fixtures.js';
afterEach(() => vi.useRealTimers());

it('serializes accepted report content requests to match the backend single-content owner', async () => {
  const held = deferred<Response>(); const entered = deferred<void>(); let calls = 0; let active = 0; let peak = 0;
  const f = fixture({ fetch: async () => {
    calls++; active++; peak = Math.max(peak, active);
    if (calls === 1) { entered.resolve(); const response = await held.promise; active--; return response; }
    active--; return new Response(f.bytes);
  } });
  const first = f.reads.read(f.input); await entered.promise;
  const second = f.reads.read({ ...f.input, signal: new AbortController().signal });
  try {
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    held.resolve(new Response(f.bytes)); await Promise.all([first, second]);
    expect(calls).toBe(2); expect(peak).toBe(1);
  } finally { held.resolve(new Response(f.bytes)); await Promise.allSettled([first, second]); }
});

it('includes queued wire time in the original five-second deadline and issues no expired fetch', async () => {
  vi.useFakeTimers(); const held = deferred<Response>(); const entered = deferred<void>(); let calls = 0;
  const f = fixture({ fetch: async () => { calls++; entered.resolve(); return held.promise; } });
  const first = f.reads.read(f.input); await entered.promise;
  const second = f.reads.read({ ...f.input, signal: new AbortController().signal });
  const expired = expect(second).rejects.toThrow();
  try {
    await vi.advanceTimersByTimeAsync(5001); await expired;
    expect(calls).toBe(1);
  } finally {
    held.resolve(new Response(f.bytes)); await Promise.allSettled([first, second]);
  }
});

it('keeps the wire until aborted body cancellation settles before starting the successor', async () => {
  const cancelling = deferred<void>(); const cancelStarted = deferred<void>(); const fetched = deferred<void>();
  let calls = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelStarted.resolve(); return cancelling.promise; } });
  const f = fixture({ fetch: async () => { calls++; fetched.resolve(); return new Response(calls === 1 ? stream : f.bytes); } });
  const first = f.reads.read(f.input); await fetched.promise;
  f.controller.abort(); await cancelStarted.promise;
  const second = f.reads.read({ ...f.input, signal: new AbortController().signal });
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); expect(calls).toBe(1);
    cancelling.resolve(); await expect(first).rejects.toThrow(); await second;
    expect(calls).toBe(2);
  } finally { cancelling.resolve(); await Promise.allSettled([first, second]); }
});
