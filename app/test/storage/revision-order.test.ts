import { expect, it } from 'vitest';
import { encodeRevisionListCursor } from '@beetle/contracts/api';
import { firstRevisionPageSql, revisionPageSql } from '../../src/adapters/outbound/sqlite/suite-reads.js';
import { seed, scope, storageFixture, uuid } from './fixture.js';
import { append, createSuite, request } from './suites-fixture.js';
import { rawConnection } from './raw-connection-fixture.js';
const f = storageFixture();
it('pages globally newest-first across nonchronological UUIDs, projects boundary predecessors and survives reopen', async () => {
 const path = f.path(); let db = await f.open(path); await seed(db);
 let suite = await createSuite(db);
 const ids = [900, 100, 700, 200];
 const revisions = [];
 for (const id of ids) { revisions.push(await append(db, suite, id, request(suite.version))); suite = await db.suites.getSuite({ scope, id: suite.id }); }
 const first = await db.suites.listRevisions({ scope, suiteId: suite.id, limit: 2 });
 expect(first.items.map(x => x.id)).toEqual([uuid(200), uuid(700)]);
 expect(first.items.map(x => x.previousRevisionId)).toEqual([uuid(700), uuid(100)]);
 await f.close(db); db = await f.open(path);
 const second = await db.suites.listRevisions({ scope, suiteId: suite.id, limit: 2, cursor: first.nextCursor! });
 expect(second.items.map(x => x.id)).toEqual([uuid(100), uuid(900)]);
 expect(second.items.map(x => x.previousRevisionId)).toEqual([uuid(900), null]);
 expect(second.nextCursor).toBeNull();
 const other = await createSuite(db, 51);
 await expect(db.suites.listRevisions({ scope, suiteId: other.id, limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
 await expect(db.suites.listRevisions({ scope, suiteId: suite.id, limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
 const forged = encodeRevisionListCursor({ scope, suiteId: suite.id, limit: 2, ordinal: 3, id: uuid(900) });
 await expect(db.suites.listRevisions({ scope, suiteId: suite.id, limit: 2, cursor: forged })).rejects.toMatchObject({ code: 'invalid_input' });
 expect(await db.suites.getRevision({ scope, id: revisions[0]!.id })).toEqual(revisions[0]);
 await f.close(db);
 const raw = rawConnection(path);
 try {
  const values = [scope.organizationId, scope.workspaceId, suite.id];
  const variants: [string, (string | number)[]][] = [[firstRevisionPageSql, [...values, 3]], [revisionPageSql, [...values, Number.MAX_SAFE_INTEGER, 3]]];
  for (const [sql, args] of variants) {
   const plan = raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args);
   const details = plan.map(x => String(x.detail));
   expect(details.filter(x => /^SEARCH suite_revisions\b/.test(x))).toHaveLength(1);
   expect(details.some(x => /SEARCH p USING (?:COVERING )?INDEX/.test(x))).toBe(true);
   expect(details.some(x => /SCAN |TEMP B-TREE/.test(x))).toBe(false);
  }
 } finally { raw.close(); }
 const archive = await f.open(path, { readOnly: true, runtime: null });
 expect(await archive.suites.listRevisions({ scope, suiteId: suite.id, limit: 2 })).toEqual(first);
 expect(await archive.suites.listRevisions({ scope, suiteId: suite.id, limit: 2, cursor: first.nextCursor! })).toEqual(second);
 await expect(append(archive, suite, 901)).rejects.toMatchObject({ code: 'read_only' });
});
it.each(['initial', 'bookmark'])('treats a corrupt ordinal as storage failure on %s reads', async (kind) => {
 const path = f.path(); const source = await f.open(path); await seed(source);
 let suite = await createSuite(source);
 await append(source, suite, 700); suite = await source.suites.getSuite({ scope, id: suite.id });
 const latest = await append(source, suite, 701);
 const page = await source.suites.listRevisions({ scope, suiteId: suite.id, limit: 1 });
 await f.close(source);
 const raw = rawConnection(path);
 try {
  const guard = raw.prepare("SELECT sql FROM sqlite_master WHERE name='revisions_no_update'").get()?.sql;
  if (typeof guard !== 'string') throw Error('Missing immutable revision guard');
  raw.exec('DROP TRIGGER revisions_no_update');
  raw.prepare('UPDATE suite_revisions SET ordinal=? WHERE id=?').run('X'.repeat(1_048_577), latest.id);
  raw.exec(guard);
 } finally { raw.close(); }
 const reopened = await f.open(path);
 await expect(reopened.suites.listRevisions({ scope, suiteId: suite.id, limit: 1, ...(kind === 'bookmark' ? { cursor: page.nextCursor! } : {}) }))
  .rejects.toMatchObject({ code: 'unavailable' });
});
