import { gateFor } from '../producer-gate/fixtures.js';
import { afterEach, vi } from 'vitest';
import { setTimeout as wait } from 'node:timers/promises';
import type { OutputRangeOptions, OutputRangeReader, OutputRangeResult } from '../../src/collection/output/index.js';
import { createOutputSourceReader } from '../../src/output-transfer/index.js';
import type { OutputSourceReaderOptions } from '../../src/output-transfer/index.js';
import type { SourceChunkRequest } from '@beetle/contracts/output-source';
import type { SourceReceipt } from '../../src/output-source/index.js';

const pending: Promise<unknown>[] = [];
export const releases: (() => void)[] = [];
export function track<T>(promise: Promise<T>): Promise<T> {
  pending.push(promise); void promise.catch(() => undefined); return promise;
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((good, bad) => { resolve = good; reject = bad; });
  return { promise, resolve, reject };
}
export async function turns(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
export const operation = () => ({ deadline: 1000 });
export function request(receipt: SourceReceipt, artifactId: string, offset = 0, length = 65_536): SourceChunkRequest {
  return { version: 1, manifestDigest: receipt.manifestDigest, sourceDigest: receipt.sourceDigest, artifactId, offset, length };
}
function original(options: OutputRangeOptions, automatic: boolean) {
  const result = deferred<OutputRangeResult>(); const quiet = deferred<void>(); const closed = deferred<void>();
  void quiet.promise.catch(() => undefined); void closed.promise.catch(() => undefined);
  releases.push(() => { result.resolve({ ok: false, reason: 'closed' }); quiet.resolve(); closed.resolve(); });
  const close = vi.fn(() => closed.promise);
  if (automatic) {
    result.resolve({ ok: true, value: Uint8Array.from({ length: Math.min(options.length, options.artifact.bytes - options.offset) },
      (_, index) => (options.offset + index) % 251) }); quiet.resolve(); closed.resolve();
  }
  return { options, result, quiet, closed, close, public: { result: result.promise, quiesced: quiet.promise, close } };
}
export function ranges(automatic = true) {
  const originals: ReturnType<typeof original>[] = [];
  const readRange = vi.fn<OutputRangeReader>(options => {
    const work = original(options, automatic); originals.push(work); return work.public;
  });
  return { readRange, originals };
}
export function reader(journal: OutputSourceReaderOptions['journal'], native = ranges(), monotonicNow = () => 100) {
  const gate = gateFor(journal);
  return { ...native, gate, service: createOutputSourceReader({ journal, gate, readRange: native.readRange, monotonicNow }) };
}
export async function until(predicate: () => boolean): Promise<void> {
  // Real worker IPC needs elapsed time; do not advance the request's fake deadline.
  for (let index = 0; index < 200 && !predicate(); index++) await wait(5);
  if (!predicate()) throw new Error('Controlled boundary was not reached');
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0)); vi.restoreAllMocks(); vi.useRealTimers();
});
