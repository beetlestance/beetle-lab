import { appendFile, lstat, readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, finish, fixture, record } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
it('validates closed bounded records and phase/writer/version values before artifact opens', async () => {
  let opens = 0; files = await fixture({ ...nativePort, open: async (...args) => { opens++; return nativePort.open(...args); } });
  for (const artifact of [
    { version: 0 }, { ordinal: -1 }, { token: 'invalid' }, { bytes: Number.MAX_SAFE_INTEGER + 1 },
    { offset: 4 }, { phase: 'published', writer: null, offset: 3 }, { writer: null }, { extra: 'unexpected' },
  ]) {
    const value = record(); const invalid = { ...value, artifact: { ...value.artifact, ...artifact } };
    await expect(finish(files.store.prepare(invalid as typeof value, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  }
  const oversized = record(); Object.assign(oversized.binding, { unexpected: 'x'.repeat(4097) });
  await expect(finish(files.store.prepare(oversized, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  let reads = 0; const getter = record(); Object.defineProperty(getter.binding, 'journalAuthority', { enumerable: true, get() { reads++; return 'x'; } });
  await expect(finish(files.store.prepare(getter, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(reads).toBe(0); expect(opens).toBe(0);
});
it('uses intrinsic view length before copying and captures a bounded view without foreign getters', async () => {
  files = await fixture(); let value = record(Buffer.alloc(65_536, 7)); value = advance(value, await finish(files.store.prepare(value, context())));
  let getters = 0;
  class FalseLength extends Uint8Array { override get byteLength() { getters++; return 1; } }
  await expect(finish(files.store.append({ record: value, offset: 0, bytes: new FalseLength(65_537) }, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(getters).toBe(0); expect((await lstat(files.path(value))).size).toBe(0);
  const backing = new Uint8Array(131_072); const view = backing.subarray(100, 100 + 65_536); view.fill(7);
  const job = files.store.append({ record: value, offset: 0, bytes: view }, context()); view.fill(0);
  expect((await finish(job)).offset).toBe(65_536); expect(await readFile(files.path(value))).toEqual(Buffer.alloc(65_536, 7));
});
it.each(['capacity', 'enospc', 'flush'] as const)('does not issue a positive byte receipt after %s failure', async kind => {
  let enabled = false;
  files = await fixture({ ...nativePort,
    statfs: async (...args) => { const value = await nativePort.statfs(...args); return enabled && kind === 'capacity' ? { ...value, bavail: 0n } : value; },
    write: async (...args) => { if (enabled && kind === 'enospc') throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }); return nativePort.write(...args); },
    sync: async handle => { await nativePort.sync(handle); if (enabled && kind === 'flush' && !(await handle.stat()).isDirectory()) throw new Error('Synthetic flush reply loss'); },
  });
  let value = record(); value = advance(value, await finish(files.store.prepare(value, context()))); enabled = true;
  const job = files.store.append({ record: value, offset: 0, bytes: Buffer.from('abc') }, { ...context(), freeSpaceReserveBytes: 1 });
  await expect(finish(job)).rejects.toMatchObject({ code: kind === 'flush' ? 'io' : 'capacity_unavailable' });
});
it('does not re-create or truncate custody when durable offset exceeds the physical extent', async () => {
  files = await fixture(); let value = record(); value = advance(value, await finish(files.store.prepare(value, context())));
  value = { ...value, artifact: { ...value.artifact, offset: 2 } };
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'integrity' });
  expect((await lstat(files.path(value))).size).toBe(0); await appendFile(files.path(value), 'abcd');
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'integrity' });
  expect(await readFile(files.path(value))).toEqual(Buffer.from('abcd'));
});
it('rejects forged signals and invalid/future deadlines without consuming artifact IO', async () => {
  let opens = 0; files = await fixture({ ...nativePort, open: async (...args) => { opens++; return nativePort.open(...args); } });
  for (const changes of [{ deadline: NaN }, { deadline: Infinity }, { deadline: context().deadline + 300_001 },
    { signal: { aborted: false } as AbortSignal }, { freeSpaceReserveBytes: -1 }]) {
    await expect(finish(files.store.prepare(record(), { ...context(), ...changes }))).rejects.toMatchObject({ code: 'invalid_input' });
  }
  expect(opens).toBe(0);
});
