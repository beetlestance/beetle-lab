import { expect, it, vi } from 'vitest';
import type { StatementSync } from 'node:sqlite';
import { Store } from '../../src/journal/store.js';
import { journalFixture } from './fixtures.js';
import { rawJournal } from './raw-connection.js';
const f = journalFixture();
it('preserves indexed journal/replay ordering and bounded runnable joins', async () => {
  const path = f.path();
  const journal = await f.open(path);
  await journal.immutableOffer(f.offer());
  await journal.appendWrapper(f.wrapper(1));
  await f.close(journal);
  const db = rawJournal(path);
  const prepare = db.prepare.bind(db);
  const observed: { sql: string; args: Parameters<StatementSync['all']> }[] = [];
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);
    vi.spyOn(statement, 'all').mockImplementation((...args) => {
      if (sql.includes('ORDER BY')) observed.push({ sql, args });
      return all(...args);
    });
    return statement;
  });
  try {
    const store = new Store(db);
    store.execute({ id:1,kind: 'list', page: { limit: 1 } });
    store.execute({ id:2,kind: 'events', key: f.key(), after: 0 });
    for (const lane of ['charged', 'queued', 'delivery'] as const)
      store.execute({ id:3,kind: 'runnable', page: { lane, limit: 1 } });
    expect(observed.length).toBeGreaterThanOrEqual(6);
    for (const query of observed) {
      const details = prepare('EXPLAIN QUERY PLAN ' + query.sql)
        .all(...query.args)
        .map((row) => String(row.detail))
        .join('\n');
      if (query.sql.includes('FROM (SELECT id,attempt_id')) {
        // These joins sort at most the already-limited source window.
        expect(query.sql).toMatch(/ORDER BY id LIMIT \?\) [rq]/);
        expect(query.args.at(-1)).toBe(2);
      } else expect(details, query.sql).not.toMatch(/TEMP B-TREE.*ORDER BY/);
    }
  } finally {
    spy.mockRestore();
    db.close();
  }
});
