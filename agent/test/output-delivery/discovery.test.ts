import { expect, it, vi } from 'vitest';
import { RunnableScan } from '../../src/journal/runnable.js';
import type { RunnableRequest } from '../../src/journal/index.js';
import { deliveryFixture } from './fixtures.js';
const f = deliveryFixture();

it('discovers released source debt after restart with finite upper amid new arrivals and atomic marker clearance', async () => {
  const e = await f.ready(); const second = await f.next(e.journal, e, 2);
  await f.close(e.journal); const journal = await f.open(e.path);
  const page = await journal.scanRunnable({ lane: 'delivery', limit: 1 });
  expect(page).toEqual({ attempts: [e.key], cursor: 1, through: 2 });
  const charged = await f.next(journal, e, 3, false);
  expect(await journal.scanRunnable({ lane: 'delivery', limit: 32 })).toEqual({ attempts: [e.key, second.key], through: 2 });
  await journal.releaseOutputSource(charged.receipt); const fourth = await f.next(journal, e, 4);
  await journal.closeOutputDelivery(e.receipt);
  expect(await journal.scanRunnable({ lane: 'delivery', limit: 1, cursor: page.cursor!, through: page.through! }))
    .toEqual({ attempts: [second.key], through: 2 });
  expect(await journal.scanRunnable({ lane: 'delivery', limit: 32 })).toEqual({ attempts: [second.key, charged.key, fourth.key], through: 4 });
  expect((await journal.scanRunnable({ lane: 'charged', limit: 100 })).attempts).toEqual([]);
});
it('captures empty upper zero and keeps the old pass empty when debt arrives afterward', async () => {
  const e = await f.seed(); expect(await e.journal.scanRunnable({ lane: 'delivery', limit: 32 })).toEqual({ attempts: [], through: 0 });
  await e.journal.beginOutputCollection(e.intent); const receipt = await e.journal.commitOutputSource(e.collected); await e.journal.releaseOutputSource(receipt);
  expect(await e.journal.scanRunnable({ lane: 'delivery', limit: 32, through: 0 })).toEqual({ attempts: [], through: 0 });
  expect(await e.journal.scanRunnable({ lane: 'delivery', limit: 32 })).toEqual({ attempts: [e.key], through: 1 });
});
it.each([
  { lane: 'delivery', limit: 33 }, { lane: 'delivery', limit: 0 }, { lane: 'delivery', limit: 1, cursor: -1 },
  { lane: 'delivery', limit: 1, through: -1 }, { lane: 'delivery', limit: 1, through: 1.5 },
  { lane: 'delivery', limit: 1, through: Number.MAX_SAFE_INTEGER + 1 },
  { lane: 'charged', limit: 1, through: 0 }, { lane: 'queued', limit: 1, through: 0 },
  { lane: 'delivery', limit: 1, extra: true },
])('rejects bounded/old-lane request $lane/$limit/$through without issuing a worker original', async page => {
  const e = await f.seed(); const worker = Reflect.get(e.journal, 'worker'); const post = vi.spyOn(worker, 'postMessage');
  await expect(e.journal.scanRunnable(page as RunnableRequest)).rejects.toMatchObject({ code: 'invalid_input' }); expect(post).not.toHaveBeenCalled();
});
it('uses the partial pending index/range before LIMIT and never prepares history payload scans', async () => {
  const e = await f.nativeReady(); const prepare = vi.spyOn(e.db, 'prepare'); const scan = new RunnableScan(e.db);
  expect(scan.read({ lane: 'delivery', limit: 1 })).toEqual({ attempts: [e.key], through: 1 });
  const queries = prepare.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('output_delivery_pending'));
  expect(queries).toHaveLength(2);
  for (const query of queries) {
    expect(query).not.toMatch(/offer_json|source_json|intent_json|canonical_json|SELECT \*/);
    const args = query.includes('LIMIT ?') ? [0, 1, 2] : [];
    const plan = e.db.prepare('EXPLAIN QUERY PLAN ' + query).all(...args).map(row => row.detail).join('\n');
    expect(plan).toContain('output_delivery_pending');
  }
  expect(queries.find(query => query.includes('LIMIT ?'))).toMatch(/a\.id>\? AND a\.id<=\? ORDER BY a\.id LIMIT \?/);
  expect(() => scan.read({ lane: 'delivery', limit: 100 })).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
