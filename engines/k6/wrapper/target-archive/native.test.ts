import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { promises as realFs } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { deferred, fixture, sample } from './fixtures.test-support.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof fs>(); return { ...actual, open: vi.fn(actual.open) };
});
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it('uses bounded positional native partial writes and waits for the actual held write after abort', async () => {
  const gate = deferred(); const entered = deferred(); let hold = false; let maxLength = 0; let writes = 0;
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args);
    if (String(args[0]).endsWith('target-samples.ndjson')) {
      return new Proxy(file, { get(target, key) {
        if (key === 'write') return async (buffer: unknown, offset: unknown, length: unknown, position: unknown) => {
          assert(buffer instanceof Uint8Array && typeof offset === 'number' && typeof length === 'number' && typeof position === 'number');
          maxLength = Math.max(maxLength, length); writes++;
          if (hold) { entered.resolve(); await gate.promise; }
          return target.write(buffer, offset, Math.min(length, Math.max(1, Math.floor(length / 2))), position);
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    return file;
  });
  const f = await fixture(); cleanups.push(f.dispose); hold = true;
  const pending = f.archive.append(sample()); const rejection = expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
  await entered.promise; f.cancel();
  let closed = false; const closing = f.archive.close().then(() => { closed = true; });
  await Promise.resolve(); await Promise.resolve(); expect(closed).toBe(false);
  gate.resolve(); await rejection; await closing;
  expect(maxLength).toBeLessThanOrEqual(65536); expect(writes).toBeLessThanOrEqual(66);
  expect(f.archive.completedPrefix()).toBeUndefined();
});
it('keeps a failed native close sticky and never presents a prefix afterward', async () => {
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args);
    if (String(args[0]).endsWith('target-samples.ndjson')) {
      const close = file.close.bind(file);
      vi.spyOn(file, 'close').mockImplementation(async () => { await close(); throw Error('synthetic close failure'); });
    }
    return file;
  });
  const f = await fixture(); cleanups.push(async () => { await expect(f.dispose()).rejects.toMatchObject({ reason: 'cleanup' }); });
  await f.archive.append(sample()); await expect(f.archive.close()).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.archive.quiescence).toBe('failed'); expect(f.archive.completedPrefix()).toBeUndefined();
  await expect(f.archive.close()).rejects.toMatchObject({ reason: 'cleanup' });
});
it('bounds a non-progressing native writer without an append retry or further intake', async () => {
  let zero = false; let calls = 0;
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args);
    if (String(args[0]).endsWith('target-samples.ndjson')) {
      const write = file.write.bind(file);
      vi.spyOn(file, 'write').mockImplementation(async (...parameters) => {
        if (zero) { calls++; return { bytesWritten: 0, buffer: parameters[0] }; }
        return write(...parameters);
      });
    }
    return file;
  });
  const f = await fixture(); cleanups.push(f.dispose); zero = true;
  await expect(f.archive.append(sample())).rejects.toMatchObject({ reason: 'artifact' });
  await expect(f.archive.append(sample(1))).rejects.toMatchObject({ reason: 'artifact' });
  expect(calls).toBe(1); expect(f.archive.completedPrefix()).toBeUndefined();
});
