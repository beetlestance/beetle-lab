import { expect, it, vi } from 'vitest';
import type { EventPage } from '../../../src/ports/events.js';
import { eventFixture } from './fixtures.js';
import { acknowledge, reserveAndMark } from '../execution-foundation-fixtures.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
it('uses bounded indexed scalar scans, retains released originals and finishes its captured upper pass', () => {
  const f = eventFixture(10000,10000000);
  function add(id: number) {
    const key = f.add(id, 'parallel', 100, 100);
    transaction(f.db, () => { reserveAndMark(f.db, key); acknowledge(f.db, key); });
    f.release(key); return key;
  }
  f.release(f.binding.key);
  for (let index = 0; index < 70; index++) add(1000 + index);
  const scan = (cursor?: string) => f.store.execute({ kind: 'eventScan', query: { limit: 32, ...(cursor ? {cursor} : {}) } }) as EventPage;
  const prepare = f.db.prepare.bind(f.db); const sql: string[] = [];
  const spy = vi.spyOn(f.db, 'prepare').mockImplementation(query => { sql.push(query); return prepare(query); });
  const first = scan(); expect(first.items).toHaveLength(32); expect(first.items[0]).toMatchObject({ kind: 'ready', binding: f.binding });
  spy.mockRestore(); const arrival = add(2000);
  const second = scan(first.nextCursor!); const third = scan(second.nextCursor!);
  expect(second.items).toHaveLength(32); expect(third.items).toHaveLength(7); expect(third.nextCursor).toBeNull();
  expect([...first.items, ...second.items, ...third.items].some(item => item.kind === 'ready' && item.binding.key.runId === arrival.runId)).toBe(false);
  expect(scan(third.items.at(-1)!.after).items).toEqual([]);
  expect(sql.every(query => !/offer_json|snapshot_json|SELECT \*/.test(query))).toBe(true);
  const bounded = sql.find(query => query.includes('LIMIT ?'))!;
  expect(bounded).toContain('INDEXED BY execution_event_pending');
  expect(f.db.prepare('EXPLAIN QUERY PLAN ' + bounded).all(0, '', 100000, 'z', 33).map(row => row.detail).join('\n'))
    .toMatch(/SEARCH execution_records USING INDEX execution_event_pending/);
});
it('rejects cursor reuse across installations/lanes and malformed upper positions', () => {
  const f = eventFixture(); const page = f.store.execute({ kind: 'eventScan', query: { limit: 1 } }) as EventPage;
  const token = page.items[0]!.after;
  const decoded = JSON.parse(Buffer.from(token, 'base64url').toString()) as Record<string, unknown>;
  for (const patch of [{ installation: 'other' }, { lane: 'queued' }, { upper: [-1, ''] }, { after: [Number.MAX_SAFE_INTEGER, 'z'] }]) {
    const cursor = Buffer.from(JSON.stringify({ ...decoded, ...patch })).toString('base64url');
    expect(() => f.store.execute({ kind: 'eventScan', query: { limit: 1, cursor } })).toThrow();
  }
  expect(() => f.store.execute({ kind: 'eventScan', query: { limit: 33 } })).toThrow();
  expect(() => f.store.execute({ kind: 'eventScan', query: { limit: 1, cursor: 'a'.repeat(1025) } })).toThrow();
});
