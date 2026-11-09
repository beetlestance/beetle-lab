import { writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { context, deferred, finish, fixture, pending, record } from './fixture.js';
import type { Fixture } from './fixture.js';

describe('verified bounded published input content', () => {
  let files: Fixture;
  afterEach(async () => { await files?.dispose(); });

  it('verifies and streams8MiB with bounded native buffers and awaited sink chunks', async () => {
    let largestRead = 0; let largestWrite = 0; let count = 0; let total = 0;
    files = await fixture({ ...nativePort, read: (handle, bytes, position) => {
      largestRead = Math.max(largestRead, bytes.byteLength); return nativePort.read(handle, bytes, position);
    } });
    const bytes = Buffer.alloc(8_388_608, 73); const input = record(bytes); input.state = 'published'; input.offset = input.bytes;
    await files.seed(input, bytes, true);
    await finish(files.store.read(input, { start: 0, endExclusive: input.bytes }, { write: async chunk => {
      largestWrite = Math.max(largestWrite, chunk.byteLength); count++; total += chunk.byteLength;
      expect(chunk.every(byte => byte === 73)).toBe(true);
    } }, context));
    expect(largestRead).toBe(65_536); expect(largestWrite).toBe(65_536); expect(count).toBe(128); expect(total).toBe(input.bytes);
  });

  it('verifies whole content before delivering a range and supports empty internal ranges', async () => {
    files = await fixture(); const bytes = Buffer.from('a☃bcdef'); const input = record(bytes); input.state = 'published'; input.offset = input.bytes;
    await files.seed(input, bytes, true); const chunks: Uint8Array[] = [];
    await finish(files.store.read(input, { start: 1, endExclusive: 4 }, { write: async chunk => { chunks.push(chunk); } }, context));
    expect(Buffer.concat(chunks)).toEqual(bytes.subarray(1, 4)); const write = vi.fn(async () => undefined);
    await finish(files.store.read(input, { start: input.bytes, endExclusive: input.bytes }, { write }, context)); expect(write).not.toHaveBeenCalled();
    const changed = Buffer.from(bytes); changed[changed.byteLength - 1] = 120; await writeFile(files.path(input, true), changed);
    await expect(finish(files.store.read(input, { start: 0, endExclusive: 1 }, { write }, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(write).not.toHaveBeenCalled();
  });

  it('verifies empty files, rejects missing published custody and rejects invalid ranges before sink invocation', async () => {
    files = await fixture(); const input = record(); input.state = 'published'; const write = vi.fn(async () => undefined);
    await expect(finish(files.store.read(input, { start: 0, endExclusive: 0 }, { write }, context))).rejects.toMatchObject({ code: 'custody_missing' });
    await files.seed(input, new Uint8Array(), true);
    await finish(files.store.read(input, { start: 0, endExclusive: 0 }, { write }, context));
    for (const range of [{ start: -1, endExclusive: 0 }, { start: 1, endExclusive: 0 }, { start: 0, endExclusive: 1 }, { start: 0.5, endExclusive: 0.5 }]) {
      await expect(finish(files.store.read(input, range, { write }, context))).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(write).not.toHaveBeenCalled();
  });

  it('retains originals through sink backpressure and cancellation, with no next chunk', async () => {
    let closes = 0; files = await fixture({ ...nativePort, close: async handle => { closes++; await nativePort.close(handle); } });
    const bytes = Buffer.alloc(131_072, 90); const input = record(bytes); input.state = 'published'; input.offset = input.bytes;
    await files.seed(input, bytes, true); const gate = deferred(); const entered = deferred(); const controller = new AbortController();
    const write = vi.fn(async () => { entered.resolve(); await gate.promise; });
    const job = files.store.read(input, { start: 0, endExclusive: input.bytes }, { write }, { ...context, signal: controller.signal });
    const rejection = expect(job.result).rejects.toMatchObject({ code: 'cancelled' });
    await entered.promise; controller.abort(); expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true); expect(closes).toBe(0);
    gate.resolve(); await rejection; await job.settled; expect(write).toHaveBeenCalledTimes(1); expect(closes).toBeGreaterThan(0);
  });

  it('captures the requested range before an original open is held and respects read short counts', async () => {
    const gate = deferred(); const entered = deferred(); let held = false;
    files = await fixture({ ...nativePort,
      open: async (path, flags, mode) => {
        const handle = await nativePort.open(path, flags, mode);
        if (!held) { held = true; entered.resolve(); await gate.promise; } return handle;
      },
      read: (handle, bytes, position) => nativePort.read(handle, bytes.subarray(0, 1), position),
    });
    const bytes = Buffer.from('abcdef'); const input = record(bytes); input.state = 'published'; await files.seed(input, bytes, true);
    const range = { start: 1, endExclusive: 3 }; const chunks: Uint8Array[] = [];
    const job = files.store.read(input, range, { write: async chunk => { chunks.push(chunk); } }, context);
    await entered.promise; range.start = 4; range.endExclusive = 6; gate.resolve(); await finish(job);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('bc'));
  });

  it('reports sink failure safely and closes all originals before rejection', async () => {
    let opened = 0; let closed = 0; files = await fixture({ ...nativePort,
      open: async (path, flags, mode) => { opened++; return nativePort.open(path, flags, mode); },
      close: async handle => { closed++; await nativePort.close(handle); },
    });
    const bytes = Buffer.from('safe'); const input = record(bytes); input.state = 'published'; await files.seed(input, bytes, true);
    const job = files.store.read(input, { start: 0, endExclusive: input.bytes }, { write: async () => { throw new Error('private content'); } }, context);
    await expect(job.result).rejects.toMatchObject({ code: 'io', message: 'Input byte operation failed' }); await job.settled;
    expect(closed).toBe(opened);
  });
});
