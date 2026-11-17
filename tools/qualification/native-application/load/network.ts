/** Diagnostic timing only; preserves the original Response and every body/signal. */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage<number>();
let sequence = 0;
export function measuredCall<T>(action: (id: number) => Promise<T>): Promise<T> {
  const id = ++sequence;
  assert(id <= 2048);
  return context.run(id, () => action(id));
}
interface NetworkCall {
  readonly id: number;
  readonly startedMs: number;
  readonly headersMs: number;
  readonly status: number;
}
export async function observeNetwork<T>(
  origin: string,
  action: () => Promise<T>,
  checkpoint: (calls: readonly NetworkCall[]) => void,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: NetworkCall[] = [];
  globalThis.fetch = async (input, init) => {
    const id = context.getStore();
    if (id === undefined) return original(input, init);
    assert(new URL(String(input)).origin === origin && calls.length < 512);
    const startedMs = performance.now();
    let status = 0;
    try {
      const reply = await original(input, init);
      status = reply.status;
      return reply;
    } finally {
      calls.push({ id, startedMs, headersMs: performance.now() - startedMs, status });
    }
  };
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
    checkpoint(calls);
  }
}
