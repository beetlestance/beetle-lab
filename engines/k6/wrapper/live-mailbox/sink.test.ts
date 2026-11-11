import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { captureMailboxImage, MAILBOX_BYTES, MAILBOX_HEADER_BYTES } from '@beetle/contracts/live-mailbox';
import { createMailboxSink, type MailboxFile } from './index.js';
function fixture(overrides: Partial<MailboxFile> = {}, budget = 1000000) {
  const image = new Uint8Array(MAILBOX_BYTES); const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const close = vi.fn(async () => {});
  const file: MailboxFile = {size: async () => image.length, close, write: async (bytes, position) => {image.set(bytes, position); return bytes.length;}, ...overrides};
  return {image, hash, close, file, sink: createMailboxSink({file, hash, maximumProducedBytes: budget})};
}
function deferred() {let resolve!: () => void; const promise = new Promise<void>(pass => {resolve = pass;}); return {promise, resolve};}
const signal = () => new AbortController().signal;
it('publishes matching committed envelopes, exact digest and increasing revisions with full IO charge', async () => {
  const f = fixture(); const frame = new TextEncoder().encode('first'); await f.sink.write(frame, signal());
  expect(captureMailboxImage(f.image, f.hash)).toMatchObject({revision: 1, frame});
  await f.sink.write(new Uint8Array([1]), signal()); expect(captureMailboxImage(f.image, f.hash)).toMatchObject({revision: 2, frame: new Uint8Array([1])});
  expect(f.sink.state().chargedBytes).toBe(6 + 8 * MAILBOX_HEADER_BYTES); await f.sink.close();
});
it('retains one original, copies input and exposes busy data as unavailable until complete', async () => {
  const held = deferred(); const entered = deferred(); const f = fixture(); const write = f.file.write; let calls = 0;
  const g = createMailboxSink({file: {...f.file, write: async (bytes, position) => {calls++; if (calls === 3) {entered.resolve(); await held.promise;} return write(bytes, position);}}, hash: f.hash, maximumProducedBytes: 1000000});
  const bytes = new Uint8Array([1, 2]); const original = g.write(bytes, signal()); bytes.fill(9); await entered.promise;
  await expect(g.write(bytes, signal())).rejects.toMatchObject({code: 'busy'}); expect(() => captureMailboxImage(f.image, f.hash)).toThrow();
  held.resolve(); await original; expect(captureMailboxImage(f.image, f.hash).frame).toEqual(new Uint8Array([1, 2])); await g.close();
});
it('fences close during a held body original, never commits it and waits for file close', async () => {
  const held = deferred(); const entered = deferred(); const closed = deferred(); const f = fixture(); const write = f.file.write; let calls = 0;
  const g = createMailboxSink({file: {...f.file, close: () => closed.promise, write: async (bytes, position) => {if (++calls === 3) {entered.resolve(); await held.promise;} return write(bytes, position);}}, hash: f.hash, maximumProducedBytes: 1000000});
  const original = g.write(new Uint8Array([1]), signal()); const failure = expect(original).rejects.toMatchObject({code: 'closed'}); await entered.promise;
  const close = g.close(); expect(g.close()).toBe(close); let finished = false; void close.then(() => {finished = true;});
  held.resolve(); await failure; await Promise.resolve(); expect(finished).toBe(false); expect(() => captureMailboxImage(f.image, f.hash)).toThrow();
  closed.resolve(); await close; expect(g.state().quiescence).toBe('confirmed');
});
it('bounds quota and input, and rejects truncation before issuing a write', async () => {
  const f = fixture({}, 512); await expect(f.sink.write(new Uint8Array([1]), signal())).rejects.toMatchObject({code: 'quota'});
  await expect(f.sink.write(new Uint8Array(65537), signal())).rejects.toMatchObject({code: 'invalid_input'});
  await expect(f.sink.write(new Uint8Array([1]), AbortSignal.abort())).rejects.toMatchObject({code: 'aborted'}); expect(f.sink.state().chargedBytes).toBe(0); await f.sink.close();
  const write = vi.fn(async () => 1); const truncated = fixture({size: async () => 1, write});
  await expect(truncated.sink.write(new Uint8Array([1]), signal())).rejects.toMatchObject({code: 'io'}); expect(write).not.toHaveBeenCalled(); await truncated.sink.close();
});
it('bounds partial-write calls, preserves invalid busy images and reports close failure', async () => {
  const write = vi.fn(async () => 1); const f = fixture({write, close: async () => {throw new Error('private close');}});
  await expect(f.sink.write(new Uint8Array([1]), signal())).rejects.toMatchObject({code: 'io'}); expect(write).toHaveBeenCalledTimes(64);
  expect(() => captureMailboxImage(f.image, f.hash)).toThrow(); await expect(f.sink.close()).rejects.toMatchObject({code: 'io'});
  expect(f.sink.state()).toMatchObject({status: 'failed', quiescence: 'failed'});
});
