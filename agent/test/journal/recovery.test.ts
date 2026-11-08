import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validate } from '@beetle/contracts';
import { journalFixture } from './fixtures.js';
import { offerInput } from '../../src/journal/input.js';

const f = journalFixture();
function edit(path: string, sql: string): void {
  const db = new DatabaseSync(path); try { db.exec(sql); } finally { db.close(); }
}
function createV1(path: string, collision = false): void {
  const db = new DatabaseSync(path); const offer = f.offer(); const checked = offerInput(offer);
  try {
    db.exec(`CREATE TABLE accepted_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, intent_digest TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation=1),
      state TEXT NOT NULL CHECK(state='offered'), last_seq INTEGER NOT NULL CHECK(last_seq=0),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
      offer_json TEXT NOT NULL CHECK(length(CAST(offer_json AS BLOB))<=1048576),
      canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=1048576)
    ); PRAGMA user_version=1;`);
    db.prepare(`INSERT INTO accepted_attempts VALUES (7,?,?,?,?,1,'offered',0,1,?,?)`)
      .run(offer.attemptId, offer.organizationId, offer.workspaceId, offer.intentDigest, checked.json, checked.canonical);
    if (collision) db.exec('CREATE TABLE event_spool(canary TEXT);');
  } finally { db.close(); }
}
describe('application durable ACK and retained prefix', () => {
  it('persists monotonic ACK, rejects future ACK and leaves lifecycle evidence unchanged', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    await journal.appendWrapper(f.wrapper()); await journal.appendSupervisor(f.supervisor());
    expect(await journal.acknowledge(f.ack(1))).toMatchObject({ acknowledgedSeq: 1 });
    expect(await journal.acknowledge(f.ack(0))).toMatchObject({ acknowledgedSeq: 1 });
    await expect(journal.acknowledge(f.ack(3))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(validate('AckReceipt', await journal.acknowledge(f.ack(2))).ok).toBe(true);
    await f.close(journal); journal = await f.open(path);
    expect(await journal.acknowledge(f.ack(0))).toMatchObject({ acknowledgedSeq: 2 });
    const snapshot = await journal.get(f.key()); expect(validate('AttemptSnapshot', snapshot).ok).toBe(true);
    expect(snapshot).toMatchObject({ state: 'running', phase: 'execute', lastSeq: 2, retainedStartSeq: 0 });
    expect(snapshot).not.toHaveProperty('exitEvidence'); expect(snapshot).not.toHaveProperty('result');
    expect((await journal.readEvents(f.key(), 0)).events).toHaveLength(2);
  });
  it('prunes only ACKed prefix in passes of 100, retains expiry/dedup/quota accounting across restart', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    for (let i = 1; i <= 203; i++) {
      if (i % 2) await journal.appendWrapper(f.wrapper(i)); else await journal.appendSupervisor(f.supervisor(i));
    }
    expect((await journal.prune(f.key())).pruned).toBe(0);
    await journal.acknowledge(f.ack(202));
    expect(await journal.prune(f.key())).toMatchObject({ pruned: 100, snapshot: { retainedStartSeq: 101 } });
    await expect(journal.readEvents(f.key(), 0)).rejects.toMatchObject({ code: 'cursor_expired', recovery: { lastSeq: 203, retainedStartSeq: 101 } });
    expect((await journal.readEvents(f.key(), 100)).events).toHaveLength(100);
    await expect(journal.appendWrapper(f.wrapper(1))).rejects.toMatchObject({ code: 'expired_key' });
    await expect(journal.appendSupervisor(f.supervisor(2))).rejects.toMatchObject({ code: 'expired_key' });
    expect(await journal.appendSupervisor(f.supervisor(102))).toMatchObject({ seq: 102 });
    await f.close(journal); journal = await f.open(path);
    expect(await journal.prune(f.key())).toMatchObject({ pruned: 100, snapshot: { retainedStartSeq: 201 } });
    expect((await journal.prune(f.key())).pruned).toBe(2); expect((await journal.prune(f.key())).pruned).toBe(0);
    const batch = await journal.readEvents(f.key(), 202); expect(batch.events.map(event => event.seq)).toEqual([203]);
    await expect(journal.readEvents(f.key(), 201)).rejects.toMatchObject({ code: 'cursor_expired' });
    await expect(journal.appendSupervisor(f.supervisor(202))).rejects.toMatchObject({ code: 'expired_key' });
    await journal.acknowledge(f.ack(203)); await journal.prune(f.key());
    expect((await journal.readEvents(f.key(), 203)).events).toEqual([]);
    await journal.appendWrapper(f.wrapper(204));
    await f.close(journal);
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('SELECT spool_bytes,spool_rows FROM accepted_attempts').get()).toMatchObject({
        spool_bytes: db.prepare('SELECT sum(charged_bytes) AS total FROM event_spool').get()?.total, spool_rows: 1 });
    } finally { db.close(); }
  });
  it('rejects invalid/future read cursors, malformed ACK and quota settings', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    for (const after of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 1]) await expect(journal.readEvents(f.key(), after)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(journal.acknowledge({ ...f.ack(0), extra: 'CANARY' } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    for (const quota of [0, 1023, 67108865, 2048.5]) await expect(f.open(undefined, quota)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
describe('migration and transactional failures on real SQLite', () => {
  it('migrates v1 offers/cancel/original JSON in place and permits durable sequence advancement', async () => {
    const path = f.path(); createV1(path); const journal = await f.open(path);
    expect(await journal.immutableOffer(f.offer())).toMatchObject({ cancelRequested: true, state: 'offered', lastSeq: 0 });
    expect(await journal.readOffer(f.key())).toEqual(f.offer());
    await journal.appendWrapper(f.wrapper()); await f.close(journal);
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
      expect(db.prepare('SELECT id,cancel_requested,last_seq FROM accepted_attempts').get()).toMatchObject({ id: 7, cancel_requested: 1, last_seq: 1 });
    } finally { db.close(); }
  });
  it('rolls back the table rebuild and version on a late migration failure', async () => {
    const path = f.path(); createV1(path, true);
    await expect(f.open(path)).rejects.toMatchObject({ code: 'unavailable' });
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(db.prepare('SELECT id,cancel_requested,offer_json FROM accepted_attempts').get()).toMatchObject({ id: 7, cancel_requested: 1, offer_json: offerInput(f.offer()).json });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='accepted_attempts_v1'").get()).toBeUndefined();
      expect(() => db.prepare('UPDATE accepted_attempts SET last_seq=1').run()).toThrow();
    } finally { db.close(); }
    edit(path, 'DROP TABLE event_spool');
    const journal = await f.open(path); expect((await journal.get(f.key())).cancelRequested).toBe(true);
  });
  it.each(['append', 'prune'])('rolls back %s payload and counters when a later SQL write fails', async operation => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    await journal.durableCancel(f.key()); await journal.appendWrapper(f.wrapper()); await journal.acknowledge(f.ack(1));
    await f.close(journal);
    edit(path, `CREATE TRIGGER injected_failure BEFORE UPDATE OF ${operation === 'append' ? 'last_seq' : 'retained_start_seq'}
      ON accepted_attempts BEGIN SELECT RAISE(ABORT,'synthetic'); END;`);
    journal = await f.open(path);
    await expect(operation === 'append' ? journal.appendWrapper(f.wrapper(2)) : journal.prune(f.key())).rejects.toMatchObject({ code: 'unavailable' });
    await journal.abort();
    edit(path, 'DROP TRIGGER injected_failure');
    journal = await f.open(path);
    expect(await journal.get(f.key())).toMatchObject({ lastSeq: 1, retainedStartSeq: 0, cancelRequested: true });
    expect(await journal.readOffer(f.key())).toEqual(f.offer());
    expect((await journal.readEvents(f.key(), 0)).events).toHaveLength(1);
    expect(await journal.appendWrapper(f.wrapper())).toMatchObject({ seq: 1 });
    expect(await journal.appendWrapper(f.wrapper(2))).toMatchObject({ seq: 2 });
    expect((await journal.prune(f.key())).pruned).toBe(1);
  });
});
