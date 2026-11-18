import { afterEach, expect, it, vi } from 'vitest';
import { readLiveHistory } from '../../src/collection/live-history/index.js';
import { nodePorts } from '../../src/collection/output/index.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { historyFixture } from './fixtures.js';
import { targetFixture } from './target-fixtures.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
// Failed native credits persist for this process; other cases are isolated files.
it('keeps a failed target close charged and closes the independent descriptors exactly once', async () => {
  const f = await historyFixture(cleanups); const target = await targetFixture(f); const closed: string[] = [];
  const ports = { ...nodePorts, open: vi.fn<typeof nodePorts.open>(async (...args) => {
    const handle = await nodePorts.open(...args); const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      closed.push(String(args[0])); await close();
      if (args[0] === target.path) throw Error('synthetic original target close failure');
    });
    return handle;
  }) };
  const operation = readLiveHistory(f.options, ports);
  expect(await operation.result).toEqual({ ok: false, reason: 'io' }); await operation.quiesced;
  await expect(operation.close()).rejects.toMatchObject({ reason: 'io' });
  expect(closed).toHaveLength(4); expect(new Set(closed).size).toBe(4);
  expect(nativeCustody.status().range).toBe(1);
  const lease = nativeCustody.reserve('cleanup')!; lease.own({});
  try { expect(() => lease.bind(f.directory)).toThrow(expect.objectContaining({ reason: 'busy' })); }
  finally { lease.release(); }
});
