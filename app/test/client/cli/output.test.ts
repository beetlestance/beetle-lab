import { once } from 'node:events';
import { Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { streamOutput } from '../../../src/client/cli/output.js';
it('owns a callback-first failed write through the later error event and close', async () => {
  const stream = new Writable({write(_chunk, _encoding, callback) {callback(new Error('synthetic EPIPE'));}});
  const closed = new Promise<void>(resolve => stream.once('close', resolve));
  await expect(streamOutput(stream).write('synthetic')).rejects.toThrow('output_failed'); await closed;
  expect(stream.listenerCount('error')).toBe(0); expect(stream.listenerCount('close')).toBe(0);
});
it('destroys a blocked output on abort while retaining its error-event ownership', async () => {
  const stream = new Writable({write() {}}); const controller = new AbortController();
  const closed = new Promise<void>(resolve => stream.once('close', resolve));
  const pending = streamOutput(stream).write('synthetic', controller.signal); controller.abort();
  await expect(pending).rejects.toThrow('output_interrupted'); await closed;
  expect(stream.destroyed).toBe(true); expect(stream.listenerCount('error')).toBe(0);
});
it('writes once and releases all event listeners on success', async () => {
  const chunks: string[] = []; const stream = new Writable({write(chunk: Buffer, _encoding, callback) {chunks.push(chunk.toString()); callback();}});
  await streamOutput(stream).write('synthetic'); expect(chunks).toEqual(['synthetic']); expect(stream.listenerCount('error')).toBe(0);
  const closed = once(stream, 'close'); stream.destroy(); await closed;
});

it('does not accumulate error listeners when output was already closed', async () => {
  const stream = new Writable({write(_chunk, _encoding, callback) {callback();}});
  const closed = once(stream, 'close'); stream.destroy(); await closed;
  await expect(streamOutput(stream).write('synthetic')).rejects.toThrow('output_closed');
  expect(stream.listenerCount('error')).toBe(0); expect(stream.listenerCount('close')).toBe(0);
});
