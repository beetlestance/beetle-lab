import {rawJournal} from './raw-connection.js';
import { CURRENT_JOURNAL_SCHEMA } from './legacy-fixtures.js';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { journalFixture } from './fixtures.js';
import { offerInput } from '../../src/journal/input.js';
import { eventInput } from '../../src/journal/event-input.js';
import { migration002 } from '../../src/journal/schema.js';

const f = journalFixture();
function populateV2(path: string): void {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    db.exec(`CREATE TABLE accepted_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, intent_digest TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation=1),
      state TEXT NOT NULL CHECK(state='offered'), last_seq INTEGER NOT NULL CHECK(last_seq=0),
      cancel_requested INTEGER NOT NULL DEFAULT 0, offer_json TEXT NOT NULL, canonical_json TEXT NOT NULL
    ); PRAGMA user_version=1;`);
    const offer = f.offer(); const input = offerInput(offer);
    db.prepare("INSERT INTO accepted_attempts VALUES (7,?,?,?,?,1,'offered',0,1,?,?)")
      .run(offer.attemptId, offer.organizationId, offer.workspaceId, offer.intentDigest, input.json, input.canonical);
    db.exec(migration002);
    // Literal v2 retained-prefix fixture; current v5 mutations require their own schema.
    const event = eventInput(f.wrapper(3), 'wrapper');
    const json = JSON.stringify({ ...JSON.parse(event.json), source: 'wrapper', wrapperSeq: 3, seq: 3 });
    const bytes = Buffer.byteLength(json); const charge = bytes + Buffer.byteLength(event.canonical) + 256;
    db.prepare(`INSERT INTO event_spool VALUES (?,1,3,'wrapper',3,?,?,?,?)`)
      .run(offer.attemptId, event.canonical, json, bytes, charge);
    db.prepare(`UPDATE accepted_attempts SET last_seq=3,retained_start_seq=3,acknowledged_seq=2,
      spool_bytes=?,spool_rows=1,wrapper_high=3,supervisor_high=2,wrapper_expired=1,supervisor_expired=2`).run(charge);
    db.exec("UPDATE sqlite_sequence SET seq=100 WHERE name='accepted_attempts'");
  } finally { db.close(); }
}
function rows(path: string): { attempts: unknown[]; events: unknown[]; sequence: unknown } {
  const db = new DatabaseSync(path);
  try {
    return { attempts: db.prepare('SELECT * FROM accepted_attempts ORDER BY id').all(),
      events: db.prepare('SELECT * FROM event_spool ORDER BY seq').all(),
      sequence: db.prepare("SELECT seq FROM sqlite_sequence WHERE name='accepted_attempts'").get()?.seq };
  } finally { db.close(); }
}
describe('transactional migration003 with foreign keys enabled', () => {
  it('preserves every v2 parent/spool field, pruned source markers, cancel and autoincrement identity', async () => {
    const path = f.path(); populateV2(path); const original = rows(path);
    const journal = await f.open(path);
    expect(await journal.get(f.key())).toMatchObject({ cancelRequested: true, lastSeq: 3, retainedStartSeq: 3 });
    expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 3, supervisorOrdinal: 2 });
    await expect(journal.appendWrapper(f.wrapper(1))).rejects.toMatchObject({ code: 'expired_key' });
    await expect(journal.appendSupervisor(f.supervisor(2))).rejects.toMatchObject({ code: 'expired_key' });
    expect((await journal.readEvents(f.key(), 2)).events).toMatchObject([{ seq: 3 }]);
    await f.close(journal); const migrated = rows(path);
    expect(migrated.events).toEqual(original.events); expect(migrated.sequence).toBe(original.sequence);
    expect(migrated.attempts).toMatchObject(original.attempts);
    const db = rawJournal(path, { enableForeignKeyConstraints: true });
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(CURRENT_JOURNAL_SCHEMA);
      expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      db.prepare("UPDATE accepted_attempts SET state='admitted' WHERE id=7").run();
      expect(() => db.prepare("UPDATE event_spool SET attempt_id='missing'").run()).toThrow();
    } finally { db.close(); }
  });
  it('rolls back both streamed table rebuilds and all counters on a late migration fault', async () => {
    const path = f.path(); populateV2(path); const original = rows(path);
    const inject = new DatabaseSync(path); inject.exec("CREATE TABLE admission_settings(canary TEXT); INSERT INTO admission_settings VALUES ('keep')"); inject.close();
    await expect(f.open(path)).rejects.toMatchObject({ code: 'unavailable' });
    expect(rows(path)).toEqual(original);
    const inspect = new DatabaseSync(path);
    try {
      expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
      expect(inspect.prepare('SELECT canary FROM admission_settings').get()?.canary).toBe('keep');
      expect(inspect.prepare("SELECT name FROM sqlite_master WHERE name IN ('accepted_attempts_v3','event_spool_v3')").all()).toEqual([]);
      expect(() => inspect.prepare("UPDATE accepted_attempts SET state='admitted'").run()).toThrow();
    } finally { inspect.close(); }
  });
});
