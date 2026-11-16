import { afterEach, expect, it, vi } from 'vitest';
import type { StatementSync } from 'node:sqlite';
import { eventFixture, request } from './fixtures.js';
afterEach(() => vi.restoreAllMocks());
it.each(['row', 'counter', 'reply', 'serialization', 'commit'] as const)('rolls back the entire append on late %s failure', fault => {
  const f = eventFixture(); f.store.execute({ kind: 'eventLoad', binding: f.binding });
  const before = f.db.prepare('SELECT * FROM event_cursors').all();
  if (fault === 'row') f.db.exec("CREATE TRIGGER fault BEFORE INSERT ON run_events WHEN NEW.seq=2 BEGIN SELECT RAISE(ABORT,'row fault'); END");
  if (fault === 'counter') f.db.exec("CREATE TRIGGER fault BEFORE UPDATE ON event_cursors WHEN NEW.event_count=2 BEGIN SELECT RAISE(ABORT,'counter fault'); END");
  if (fault === 'commit') {
    const exec = f.db.exec.bind(f.db);
    vi.spyOn(f.db, 'exec').mockImplementation(sql => { if (sql === 'COMMIT') throw new Error('commit fault'); exec(sql); });
  }
  if (fault === 'serialization') {
    const stringify = JSON.stringify;
    vi.spyOn(JSON, 'stringify').mockImplementation(value => {
      if (value === 'contiguous' && f.db.prepare('SELECT count(*) n FROM run_events').get()?.n !== 0) throw new Error('serialization fault');
      return stringify(value);
    });
  }
  if (fault === 'reply') {
    const prepare = f.db.prepare.bind(f.db); let reads = 0;
    vi.spyOn(f.db, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('SELECT durable_through') && ++reads === 2) throw new Error('reply fault');
      return prepare(sql);
    });
  }
  expect(() => f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) })).toThrow('Storage unavailable');
  vi.restoreAllMocks();
  expect(f.db.prepare('SELECT * FROM event_cursors').all()).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM run_events').get()?.n).toBe(0);
});
it('fails quota diagnostic persistence without reporting a successful blocked result', () => {
  const f = eventFixture(1); f.store.execute({ kind: 'eventLoad', binding: f.binding });
  f.db.exec("CREATE TRIGGER fault BEFORE UPDATE ON event_cursors WHEN NEW.blocked_reason IS NOT NULL BEGIN SELECT RAISE(ABORT,'problem fault'); END");
  expect(() => f.store.execute({ kind: 'eventIngest', request: request(f.binding) })).toThrow('Storage unavailable');
  expect(f.db.prepare('SELECT blocked_reason,durable_through FROM event_cursors').get()).toEqual({ blocked_reason: null, durable_through: 0 });
});
it('propagates native SQLITE_FULL and retains no partial rows or quota diagnosis', () => {
  const f = eventFixture(100000); f.store.execute({ kind: 'eventLoad', binding: f.binding });
  const pages = f.db.prepare('PRAGMA page_count').get()!.page_count;
  f.db.exec(`PRAGMA max_page_count=${pages}`);
  expect(() => f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 100) })).toThrow('Storage unavailable');
  expect(f.db.prepare('SELECT count(*) n FROM run_events').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT blocked_reason,durable_through FROM event_cursors').get()).toEqual({ blocked_reason: null, durable_through: 0 });
});
it('bounds replay SQL materialization before consuming persisted text', () => {
  const f = eventFixture(); f.store.execute({ kind: 'eventIngest', request: request(f.binding) });
  const prepare = f.db.prepare.bind(f.db); const queries: string[] = [];
  vi.spyOn(f.db, 'prepare').mockImplementation(sql => { queries.push(sql); return prepare(sql) as StatementSync; });
  f.store.execute({ kind: 'eventIngest', request: request(f.binding) });
  expect(queries.find(sql => sql.includes('canonical_json FROM run_events'))).toMatch(/CASE WHEN length.*<=66048[\s\S]*LIMIT 100/);
});
