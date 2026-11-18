import { expect, it } from 'vitest';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { suiteListFixture } from './suite-list-fixture.js';
import { request, suiteCommand } from './suites-fixture.js';
import { command, requestId, scope, uuid } from './fixture.js';
const current = (f: ReturnType<typeof suiteListFixture>) => f.store.execute({ kind: 'getSuite', key: { scope, id: uuid(50) } }) as Suite;
function save(f: ReturnType<typeof suiteListFixture>, body = request(2), id = 70): SuiteRevision {
 return f.store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuiteRevision', id: uuid(id), suiteId: uuid(50), savedAt: '2026-11-18T00:00:00.000Z', request: body }) }) as SuiteRevision;
}
const counts = (f: ReturnType<typeof suiteListFixture>) => ({
 revisions: f.db.prepare('SELECT count(*) AS n FROM suite_revisions').get()?.n,
 receipts: f.db.prepare('SELECT count(*) AS n FROM receipts').get()?.n,
 pins: f.db.prepare('SELECT count(*) AS n FROM revision_input_pins').get()?.n,
});
it('saves metadata and config in one version, preserves config digest and replays without undoing later edits', () => {
 const f = suiteListFixture();
 try {

  const old = f.revision(60);
  const body = { ...request(2), metadata: { name: 'Renamed', folderId: uuid(90), description: 'Changed together' } };
  const result = save(f, body);
  expect(result.digest).toBe(old.digest);
  expect(result.ordinal).toBe(2);
  expect(current(f)).toMatchObject({ name: 'Renamed', folderId: uuid(90), description: 'Changed together', currentRevisionId: result.id, version: 3 });
  expect(f.list({ name: 'Renamed' }).items.map(x => x.id)).toEqual([uuid(50)]);
  expect(f.list({ name: 'Synthetic' }).items).toEqual([]);
  const later = { ...request(3), metadata: { name: 'Later', description: null } };
  save(f, later, 71);
  expect(save(f, body, 72)).toEqual(result);
  expect(current(f)).toMatchObject({ name: 'Later', description: null, version: 4, currentRevisionId: uuid(71) });
  expect(() => save(f, { ...body, metadata: { name: 'Different' } }, 73)).toThrow();
  expect(f.revision(60)).toEqual(old);
 } finally { f.db.close(); }
});
it.each(['stale', 'foreign folder', 'duplicate', 'invalid config', 'invalid pin'])('keeps all state on %s refusal', (kind) => {
 const f = suiteListFixture();
 try {
 f.suite(51, 'Occupied', 90);
  const before = current(f);
  const body = { ...request(2), metadata: { name: 'Renamed', folderId: uuid(90), description: 'Must roll back' } };
  if (kind === 'stale') body.expectedVersion = 1;
  if (kind === 'foreign folder') {
   f.store.execute({ kind: 'namespace', command: command({ kind: 'createWorkspace', id: uuid(92), rootFolderId: uuid(93), request: { scope: { kind: 'organization', organizationId: scope.organizationId }, requestId: requestId(), name: 'Other workspace' } }) });
   body.metadata.folderId = uuid(93);
  }
  if (kind === 'duplicate') body.metadata.name = 'OCCUPIED';
  if (kind === 'invalid config') body.config = {};
  if (kind === 'invalid pin') body.config.datasets = [{ id: 'missing', kind: 'csv', selection: 'byVu', input: { id: uuid(999), sha256: 'a'.repeat(64), bytes: 12 } }];
  const count = counts(f);
  expect(() => save(f, body)).toThrow();
  expect(current(f)).toEqual(before); expect(counts(f)).toEqual(count);
 } finally { f.db.close(); }
});
it('rolls back the inserted revision, suite edit and receipt on a late receipt failure', () => {
 const f = suiteListFixture();
 try {

  const before = current(f); const count = counts(f);
  f.db.exec("CREATE TRIGGER fail_atomic_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END");
  expect(() => save(f, { ...request(2), metadata: { name: 'Renamed', folderId: uuid(90), description: 'Discarded' } })).toThrow();
  expect(current(f)).toEqual(before); expect(counts(f)).toEqual(count);
  f.db.exec('DROP TRIGGER fail_atomic_receipt');
  expect(save(f, { ...request(2), metadata: { name: 'Accepted' } }).ordinal).toBe(2);
 } finally { f.db.close(); }
});
it('omitted metadata leaves existing fields intact, while null clears description', () => {
 const f = suiteListFixture();
 try {

  save(f, { ...request(2), metadata: { description: 'Saved' } });
  save(f, request(3), 71);
  expect(current(f)).toMatchObject({ name: 'Synthetic', folderId: uuid(3), description: 'Saved', version: 4 });
  save(f, { ...request(4), requestId: requestId(), metadata: { description: null } }, 72);
  expect(current(f).description).toBeNull();
 } finally { f.db.close(); }
});
it('denies combined metadata saves and receipt replay in restored history', async () => {
 const { markHistorical } = await import('../../src/adapters/outbound/sqlite/historical.js');
 const f = suiteListFixture();
 try {
  const body = { ...request(2), metadata: { name: 'Saved before backup' } };
  save(f, body);
  const before = current(f); const count = counts(f);
  markHistorical(f.db);
  expect(() => save(f, body)).toThrowError(expect.objectContaining({ code: 'read_only' }));
  expect(() => save(f, { ...request(3), metadata: { name: 'Forbidden' } }, 71)).toThrowError(expect.objectContaining({ code: 'read_only' }));
  expect(current(f)).toEqual(before); expect(counts(f)).toEqual(count);
 } finally { f.db.close(); }
});
it.each(['corrupt', 'exhausted'])('does not change suite metadata when the ordinal is %s', (kind) => {
 const f = suiteListFixture();
 try {
  const before = current(f); const count = counts(f);
  const guard = f.db.prepare("SELECT sql FROM sqlite_master WHERE name='revisions_no_update'").get()?.sql;
  if (typeof guard !== 'string') throw Error('Missing immutable revision guard');
  f.db.exec('DROP TRIGGER revisions_no_update');
  f.db.prepare('UPDATE suite_revisions SET ordinal=? WHERE id=?').run(kind === 'corrupt' ? 'X'.repeat(1_048_577) : Number.MAX_SAFE_INTEGER, uuid(60));
  f.db.exec(guard);
  expect(() => save(f, { ...request(2), metadata: { name: 'Must not change' } })).toThrowError(expect.objectContaining({ code: kind === 'corrupt' ? 'unavailable' : 'conflict' }));
  expect(current(f)).toEqual(before); expect(counts(f)).toEqual(count);
 } finally { f.db.close(); }
});
