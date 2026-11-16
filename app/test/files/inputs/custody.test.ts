import type { FileHandle } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { InputByteJob } from '../../../src/ports/input-bytes.js';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import type { NativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { context, deferred, finish, fixture, pending, record } from './fixture.js';
import type { Fixture } from './fixture.js';

describe('original input descriptor custody', () => {
  let files: Fixture;
  afterEach(async () => { await files?.dispose(); });

  it.each(['open', 'write', 'file-sync', 'directory-sync', 'file-close', 'directory-close'] as const)(
    'retains cancelled %s originals until completion and once-only closes', async phase => {
      const gate = deferred(); const entered = deferred(); const controller = new AbortController();
      const closes = new Map<FileHandle, number>(); const handles = new Set<FileHandle>(); let held = false;
      const hold = async () => { if (!held) { held = true; entered.resolve(); await gate.promise; } };
      const port: NativePort = { ...nativePort,
        open: async (path, flags, mode) => {
          const handle = await nativePort.open(path, flags, mode); handles.add(handle);
          if (phase === 'open') await hold(); return handle;
        },
        write: async (handle, bytes, position) => {
          const count = await nativePort.write(handle, bytes, position); if (phase === 'write') await hold(); return count;
        },
        sync: async handle => {
          await nativePort.sync(handle); const directory = (await handle.stat()).isDirectory();
          if ((phase === 'directory-sync' && directory) || (phase === 'file-sync' && !directory)) await hold();
        },
        close: async handle => {
          closes.set(handle, (closes.get(handle) ?? 0) + 1); const directory = (await handle.stat()).isDirectory();
          if ((phase === 'directory-close' && directory) || (phase === 'file-close' && !directory)) await hold();
          await nativePort.close(handle);
        },
      };
      files = await fixture(port); const input = record(Buffer.from('abc'));
      const job = files.store.append(input, 0, async () => Buffer.from('abc'), { ...context, signal: controller.signal });
      const rejection = expect(job.result).rejects.toMatchObject({ code: 'cancelled' });
      await entered.promise; controller.abort(); expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true);
      gate.resolve(); await rejection; await job.settled;
      expect(closes.size).toBe(handles.size); for (const count of closes.values()) expect(count).toBe(1);
    });

  it('retains a cancelled original read through completion before closing its owner', async () => {
    const gate = deferred(); const entered = deferred(); const controller = new AbortController(); let held = false; let closes = 0;
    files = await fixture({ ...nativePort,
      read: async (handle, bytes, position) => {
        const count = await nativePort.read(handle, bytes, position);
        if (!held) { held = true; entered.resolve(); await gate.promise; } return count;
      },
      close: async handle => { closes++; await nativePort.close(handle); },
    });
    const bytes = Buffer.from('read'); const input = record(bytes); input.state = 'published'; await files.seed(input, bytes, true);
    let sinkWrites = 0;
    const job = files.store.read(input, { start: 0, endExclusive: input.bytes }, { write: async () => { sinkWrites++; } }, { ...context, signal: controller.signal });
    const rejection = expect(job.result).rejects.toMatchObject({ code: 'cancelled' });
    await entered.promise; controller.abort(); expect(await pending(job.settled)).toBe(true); expect(closes).toBe(0);
    gate.resolve(); await rejection; await job.settled; expect(sinkWrites).toBe(0); expect(closes).toBeGreaterThan(0);
  });

  it.each(['file', 'directory'] as const)('reports failed %s close but permanently retains logical custody without a retry', async kind => {
    const calls = new Map<FileHandle, number>(); let failed = false;
    files = await fixture({ ...nativePort, close: async handle => {
      calls.set(handle, (calls.get(handle) ?? 0) + 1); const directory = (await handle.stat()).isDirectory();
      await nativePort.close(handle);
      // Controlled failure: close the real task FD first, then simulate uncertain acknowledgement.
      // The adapter must still retain logical ownership; the fixture leaks no OS descriptor.
      if (!failed && (kind === 'directory' ? directory : !directory)) {
        failed = true; throw new Error('controlled close acknowledgement failure');
      }
    } });
    const job = files.store.prepare(record(), context);
    await expect(job.result).rejects.toMatchObject({ code: 'cleanup', message: 'Input byte operation failed' });
    expect(failed).toBe(true); expect(await pending(job.settled)).toBe(true);
    await expect(job.result).rejects.toMatchObject({ code: 'cleanup' }); expect(await pending(job.settled)).toBe(true);
    for (const count of calls.values()) expect(count).toBe(1);
  });

  it('does not report success before the last original close completes', async () => {
    const gate = deferred(); const entered = deferred(); let held = false;
    files = await fixture({ ...nativePort, close: async handle => {
      const directory = (await handle.stat()).isDirectory(); await nativePort.close(handle);
      if (!held && !directory) { held = true; entered.resolve(); await gate.promise; }
    } });
    const job = files.store.prepare(record(), context); await entered.promise;
    expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true);
    gate.resolve(); await finish(job);
  });

  it('attaches jobs synchronously and does not implement a second service admission semaphore', async () => {
    let sources = 0; let opens = 0; const gate = deferred<Uint8Array>(); const entered = deferred();
    files = await fixture({ ...nativePort, open: async (path, flags, mode) => { opens++; return nativePort.open(path, flags, mode); } });
    const inputs = [record(Buffer.from('a')), record(Buffer.from('a')), record(Buffer.from('a'))];
    inputs[1]!.id = '55555555-5555-4555-8555-555555555555'; inputs[2]!.id = '66666666-6666-4666-8666-666666666666';
    const jobs: InputByteJob<number>[] = inputs.map(input => files.store.append(input, 0, () => {
      sources++; if (sources === 3) entered.resolve(); return gate.promise;
    }, context));
    expect(opens).toBe(0); expect(jobs).toHaveLength(3);
    await entered.promise; expect(sources).toBe(3); gate.resolve(Buffer.from('a'));
    expect(await Promise.all(jobs.map(finish))).toEqual([1, 1, 1]);
  });

  it('does not consume a source or open descriptors for an already cancelled job', async () => {
    let sources = 0; let opens = 0; files = await fixture({ ...nativePort,
      open: async (path, flags, mode) => { opens++; return nativePort.open(path, flags, mode); },
    });
    const controller = new AbortController(); controller.abort();
    const job = files.store.append(record(Buffer.from('a')), 0, async () => { sources++; return Buffer.from('a'); }, { ...context, signal: controller.signal });
    await expect(finish(job)).rejects.toMatchObject({ code: 'cancelled' }); expect(opens).toBe(0); expect(sources).toBe(0);
  });

  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('validates reserve %s before source consumption', async reserve => {
    let sources = 0; files = await fixture();
    await expect(finish(files.store.append(record(Buffer.from('a')), 0, async () => {
      sources++; return Buffer.from('a');
    }, { freeSpaceReserveBytes: reserve }))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(sources).toBe(0);
  });
});
