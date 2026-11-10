import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { Store } from '../../src/journal/store.js';
import type { Reservation } from '../../src/admission/index.js';
import { admissionFixture, digest, now, scope } from '../admission/fixtures.js';
import { mutateQueue, mutateReservation, releaseOriginal } from './admission-snapshot-fixtures.js';

const f = admissionFixture();
const corruption: [string, (db: DatabaseSync) => void][] = [
  ['queue malformed', db => { db.exec("UPDATE admission_queue SET candidate_json='{' "); }],
  ['queue null', db => { db.exec("UPDATE admission_queue SET candidate_json='null'"); }],
  ['queue scope', db => mutateQueue(db, value => { value.organizationId = f.job(2).organizationId; })],
  ['queue workspace', db => mutateQueue(db, value => { value.workspaceId = f.job(2).organizationId; })],
  ['queue generation', db => mutateQueue(db, value => { value.generation = 2; })],
  ['queue original budget', db => mutateQueue(db, value => { value.budget.cpuMillis = 1; })],
  ['queue config digest', db => mutateQueue(db, value => { value.validation.configDigest = 'c'.repeat(63); })],
  ['queue engine token', db => mutateQueue(db, value => { value.engine.id = 'invalid engine'; })],
  ['queue capability token', db => mutateQueue(db, value => { value.requiredCapabilities = ['invalid capability']; })],
  ['queue order', db => mutateQueue(db, value => { value.order = 1; })],
  ['queue unexpected decision', db => { db.exec(`UPDATE admission_queue SET decision_json='{"kind":"reject","reason":"per_run_ceiling"}'`); }],
  ['queue forgotten closure', db => { db.exec('UPDATE admission_queue SET pending=0'); }],
];
const reservationCorruption: [string, (db: DatabaseSync) => void][] = [
  ['reservation queue pending', db => { db.exec('UPDATE admission_queue SET pending=1'); }],
  ['reservation missing queue', db => { db.exec('DELETE FROM admission_queue'); }],
  ['reservation queue identity', db => mutateReservation(db, value => { value.order = 100; })],
];
const guardedReservationCorruption: [string, (db: DatabaseSync) => void][] = [
  ['reservation malformed', db => { db.exec("UPDATE reservations SET reservation_json='[]'"); }],
  ['reservation scope', db => mutateReservation(db, value => { value.workspaceId = f.job(2).workspaceId + '0'; })],
  ['reservation generation', db => mutateReservation(db, value => { value.generation = 2; })],
  ['reservation charged column', db => { db.exec('UPDATE reservations SET charged=0'); }],
  ['released without proof', db => {
    mutateReservation(db, value => { value.status = 'released'; }); db.exec('UPDATE reservations SET charged=0');
  }],
  ['fake abort after escaped create', db => {
    mutateReservation(db, value => { value.status = 'released'; value.aborted = true; value.launchClosed = true;
      value.createToken = 'escaped-original'; value.specDigest = digest; });
    db.exec('UPDATE reservations SET charged=0');
  }],
];
function assertReservationWriteDenied(db: DatabaseSync, change: (db: DatabaseSync) => void,
  reason = 'immutable disk reservation'): void {
  const tables = ['accepted_attempts', 'event_spool', 'admission_queue', 'reservations',
    'disk_holds', 'disk_retention_stats', 'sqlite_sequence'];
  const rows = () => tables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() }));
  const before = rows();
  expect(() => change(db)).toThrow(reason);
  expect(rows()).toEqual(before);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}
describe('bounded durable admission storage validation', () => {
  it.each(corruption)('fails closed on %s', async (_name, change) => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job(); await f.enqueue(journal, job);
    await f.close(journal); const db = new DatabaseSync(path);
    try { change(db); } finally { db.close(); }
    const reopened = await f.open(path);
    await expect(reopened.get(scope(job))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it.each(reservationCorruption)('fails closed on %s', async (_name, change) => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job();
    await f.enqueue(journal, job); await f.admit(journal, job); await f.close(journal);
    const db = new DatabaseSync(path); try { change(db); } finally { db.close(); }
    const reopened = await f.open(path);
    await expect(reopened.get(scope(job))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it.each(guardedReservationCorruption)('rejects %s at WRITE with unchanged rows, counters and valid read', async (_name, change) => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job();
    await f.enqueue(journal, job); await f.admit(journal, job);
    const before = await journal.get(scope(job)); await f.close(journal);
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try { assertReservationWriteDenied(db, change); } finally { db.close(); }
    const reopened = await f.open(path);
    expect(await reopened.get(scope(job))).toEqual(before);
  });
  it.each(['capacity_unknown', 'made_up', 'cancelled'])('rejects inconsistent durable refusal %s', async reason => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job(); await f.enqueue(journal, job);
    await f.close(journal); const db = new DatabaseSync(path);
    try { db.prepare('UPDATE admission_queue SET pending=0,decision_json=?').run(JSON.stringify({ kind: 'reject', reason })); }
    finally { db.close(); }
    const reopened = await f.open(path);
    await expect(reopened.get(scope(job))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it.each(['candidate_json', 'decision_json'] as const)('caps %s UTF-8 bytes in SQLite before materialization', async column => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job(); await f.enqueue(journal, job);
    await f.close(journal); const db = new DatabaseSync(path);
    const cap = column === 'candidate_json' ? 16384 : 512;
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.prepare(`UPDATE admission_queue SET ${column}=?`).run(JSON.stringify('🪲'.repeat(cap / 4)));
    const original = db.prepare.bind(db); const inspected: unknown[] = [];
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      const statement = original(sql);
      if (sql.includes('CASE WHEN length(CAST(') && sql.includes(column)) {
        const get = statement.get.bind(statement);
        vi.spyOn(statement, 'get').mockImplementation((...args) => {
          const row = get(...args); inspected.push(row?.[column]); return row;
        });
      }
      return statement;
    });
    try {
      const store = new Store(db);
      expect(() => store.execute({ kind: 'get', key: scope(job), id: 1 })).toThrow('unavailable');
      expect(inspected).toContain(null);
    } finally { spy.mockRestore(); db.close(); }
  });
  it('rejects oversized reservation_json at WRITE before materialization with unchanged rows and read', async () => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job();
    await f.enqueue(journal, job); await f.admit(journal, job);
    const before = await journal.get(scope(job)); await f.close(journal);
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assertReservationWriteDenied(db, connection => {
        const row = connection.prepare('SELECT reservation_json FROM reservations').get();
        const original: unknown = JSON.parse(String(row?.reservation_json));
        if (typeof original !== 'object' || original === null || Array.isArray(original)) {
          throw new Error('expected original reservation object');
        }
        const oversized = JSON.stringify({ ...original, diagnosticPadding: '🪲'.repeat(32768 / 4) });
        expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(32768);
        connection.prepare('UPDATE reservations SET reservation_json=?').run(oversized);
      }, 'CHECK constraint failed');
    } finally { db.close(); }
    const reopened = await f.open(path);
    expect(await reopened.get(scope(job))).toEqual(before);
  });
  it('keeps ordinary tracked GET/list/cancel reads compact without loading any Offer/config payload', async () => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job();
    job.config.canary = 'private-config-canary'.repeat(10_000);
    await f.enqueue(journal, job); await f.close(journal); const db = new DatabaseSync(path);
    const original = db.prepare.bind(db); const selected: string[] = [];
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      const statement = original(sql);
      const get = statement.get.bind(statement); const all = statement.all.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...args) => { selected.push(sql); return get(...args); });
      vi.spyOn(statement, 'all').mockImplementation((...args) => { selected.push(sql); return all(...args); });
      return statement;
    });
    try {
      const store = new Store(db);
      expect(store.execute({ kind: 'get', key: scope(job), id: 1 })).toMatchObject({ admission: { state: 'queued' } });
      expect(store.execute({ kind: 'list', page: { limit: 100 }, id: 2 })).toMatchObject({ snapshots: [{ admission: { state: 'queued' } }] });
      expect(store.execute({ kind: 'cancel', key: scope(job), id: 3 })).toMatchObject({ admission: { state: 'rejected', reason: 'cancelled' } });
      expect(selected.some(sql => sql.includes('offer_json') || sql.includes('canonical_json'))).toBe(false);
    } finally { spy.mockRestore(); db.close(); }
  });
  it.each([
    ['settlement generation', (value: Reservation) => { value.launchSettlement!.key.generation = 2; }],
    ['settlement scope', value => { value.launchSettlement!.key.organizationId = f.job(2).organizationId; }],
    ['release scope', value => { value.releaseEvidence!.key.workspaceId = f.job(2).organizationId; }],
    ['release generation', value => { value.releaseEvidence!.key.generation = 2; }],
    ['release token', value => { value.releaseEvidence!.createToken = 'different'; }],
    ['release runtime', value => { value.releaseEvidence!.runtimeId = 'different'; }],
    ['release spec', value => { value.releaseEvidence!.specDigest = 'c'.repeat(64); }],
    ['release settlement id', value => { value.releaseEvidence!.launch.settlementId = 'different'; }],
    ['release launch epoch', value => { value.releaseEvidence!.launch.epoch = 1; value.releaseEvidence!.launch.startToken = 'different'; }],
    ['release stale runtime', value => { value.releaseEvidence!.runtime.observedAt = now; }],
    ['release stale collection', value => { value.releaseEvidence!.collection.observedAt = now; }],
    ['release open launch', value => { value.launchClosed = false; }],
  ] satisfies [string, (value: Reservation) => void][])('fails read for corrupt %s proof', async (_name, change) => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job();
    await f.enqueue(journal, job); await f.admit(journal, job); await releaseOriginal(journal, scope(job));
    await f.close(journal); const db = new DatabaseSync(path);
    try { mutateReservation(db, change); } finally { db.close(); }
    const reopened = await f.open(path);
    await expect(reopened.get(scope(job))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects unknown settlement masquerading as released at WRITE despite matching release payloads', async () => {
    const path = f.path(); const journal = await f.configured(path); const job = f.job();
    await f.enqueue(journal, job); await f.admit(journal, job);
    const before = await journal.get(scope(job)); await f.close(journal);
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assertReservationWriteDenied(db, connection => mutateReservation(connection, value => {
        value.status = 'released'; value.createToken = 'private-create'; value.specDigest = digest; value.runtimeId = 'private-runtime';
        value.launchClosed = true;
        const binding = { key: scope(job), createToken: value.createToken, specDigest: digest, runtimeId: value.runtimeId };
        value.launchSettlement = { authority: 'supervisor', ...binding, epoch: 0, startToken: null,
          disposition: 'unknown', settledAt: now, evidenceId: 'private-settlement' };
        value.releaseEvidence = { authority: 'supervisor', ...binding,
          launch: { epoch: 0, startToken: null, settlementId: 'private-settlement' },
          runtime: { state: 'stopped', source: 'supervisor', observedAt: now + 1, evidenceId: 'private-stop' },
          collection: { state: 'finished', observedAt: now + 1, evidenceId: 'private-collection' } };
      }));
      assertReservationWriteDenied(db, connection => { connection.exec('UPDATE reservations SET charged=0'); });
    } finally { db.close(); }
    const reopened = await f.open(path);
    expect(await reopened.get(scope(job))).toEqual(before);
  });
});
