import type { FileHandle } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, deferred, finish, fixture, pending, populated, record } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
it.each(['open', 'write', 'sync', 'close'] as const)('retains cancelled %s originals and closes each original once', async phase => {
  const gate = deferred(); const entered = deferred(); const controller = new AbortController(); let enabled = false; let held = false;
  const handles = new Set<FileHandle>(); const closes = new Map<FileHandle, number>();
  const hold = async () => { if (enabled && !held) { held = true; entered.resolve(); await gate.promise; } };
  files = await fixture({ ...nativePort,
    open: async (...args) => { const handle = await nativePort.open(...args); handles.add(handle); if (phase === 'open') await hold(); return handle; },
    write: async (...args) => { const count = await nativePort.write(...args); if (phase === 'write') await hold(); return count; },
    sync: async handle => { await nativePort.sync(handle); if (phase === 'sync') await hold(); },
    close: async handle => { closes.set(handle, (closes.get(handle) ?? 0) + 1); if (phase === 'close') await hold(); await nativePort.close(handle); },
  });
  let value = record(); value = advance(value, await finish(files.store.prepare(value, context()))); handles.clear(); closes.clear(); enabled = true;
  const job = files.store.append({ record: value, offset: 0, bytes: Buffer.from('abc') }, { ...context(), signal: controller.signal });
  const rejection = expect(job.result).rejects.toMatchObject({ code: 'cancelled' });
  await entered.promise; controller.abort(); expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true);
  gate.resolve(); await rejection; await job.settled;
  expect(closes.size).toBe(handles.size); for (const count of closes.values()) expect(count).toBe(1);
});
it('retains original reads and awaited sinks through shutdown, then releases the lease last', async () => {
  let enabled = false; let held = false; const gate = deferred(); const entered = deferred();
  files = await fixture({ ...nativePort, read: async (...args) => {
    const count = await nativePort.read(...args); if (enabled && !held) { held = true; entered.resolve(); await gate.promise; } return count;
  } });
  let value = await populated(files); value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  value = advance(value, await finish(files.store.publish(value, context())), 'published'); enabled = true;
  let sinks = 0; const job = files.store.read({ record: value, start: 0, endExclusive: 3, sink: { write: async () => { sinks++; } } }, context());
  const rejected = expect(job.result).rejects.toMatchObject({ code: 'cancelled' }); await entered.promise;
  const close = files.store.close(); expect(files.store.close()).toBe(close); expect(await pending(close)).toBe(true);
  await expect(finish(files.store.prepare(record(), context()))).rejects.toMatchObject({ code: 'closed' });
  gate.resolve(); await rejected; await job.settled; await close; expect(sinks).toBe(0);
});
it('holds two original credits and one per token before capture or callbacks', async () => {
  files = await fixture(); const first = await populated(files); let second = await populated(files, Buffer.from('abc'), 9);
  const publish = async (value: typeof first) => {
    const publishing = { ...value, artifact: { ...value.artifact, phase: 'publishing' as const } };
    return advance(publishing, await finish(files.store.publish(publishing, context())), 'published');
  };
  const a = await publish(first); second = await publish(second);
  const gate = deferred(); const entered = deferred(); let calls = 0;
  const sink = { write: async () => { calls++; if (calls === 2) entered.resolve(); await gate.promise; } };
  const one = files.store.read({ record: a, start: 0, endExclusive: 3, sink }, context());
  await expect(finish(files.store.read({ record: a, start: 0, endExclusive: 3, sink }, context()))).rejects.toMatchObject({ code: 'busy' });
  const two = files.store.read({ record: second, start: 0, endExclusive: 3, sink }, context()); await entered.promise;
  let captures = 0; const invalid = new Proxy(record(), { ownKeys() { captures++; return []; } });
  await expect(finish(files.store.prepare(invalid, context()))).rejects.toMatchObject({ code: 'busy' }); expect(captures).toBe(0);
  const close = files.store.close(); expect(await pending(close)).toBe(true); gate.resolve();
  await expect(one.result).rejects.toMatchObject({ code: 'cancelled' }); await expect(two.result).rejects.toMatchObject({ code: 'cancelled' });
  await Promise.all([one.settled, two.settled, close]);
});
it.each(['expired', 'backwards', 'invalid'] as const)('fences an %s monotonic clock while retaining an issued write', async kind => {
  let now = 100; const gate = deferred(); const entered = deferred(); let enabled = false;
  files = await fixture({ ...nativePort, write: async (...args) => {
    const count = await nativePort.write(...args); if (enabled) { entered.resolve(); await gate.promise; } return count;
  } }, () => now);
  const ctx = { deadline: 200, freeSpaceReserveBytes: 0 }; let value = record(); value = advance(value, await finish(files.store.prepare(value, ctx))); enabled = true;
  const job = files.store.append({ record: value, offset: 0, bytes: Buffer.from('abc') }, ctx);
  const rejection = expect(job.result).rejects.toMatchObject({ code: 'deadline' }); await entered.promise;
  now = kind === 'expired' ? 201 : kind === 'backwards' ? 99 : NaN; expect(await pending(job.settled)).toBe(true);
  gate.resolve(); await rejection; await job.settled;
});
