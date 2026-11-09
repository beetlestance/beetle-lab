import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { journalFixture } from './fixtures.js';
import { admissionFixture, now, observation, reserved, scope } from '../admission/fixtures.js';

const f = journalFixture();
const a = admissionFixture();
function edit(path: string, sql: string): void {
  const db = new DatabaseSync(path);
  try { db.exec(sql); } finally { db.close(); }
}

it('persists first cancellation and sticky clock rollback across reopen and later recovery', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
  expect(await journal.supervision({ key: f.key(), now: 1000 })).toEqual({
    clockHighWater: 1000, clockFenced: false, cancelRequested: false, cancelRequestedAt: null, cancelReason: null, immediateStop: false });
  expect(await journal.supervision({ key: f.key(), now: 1100, cancel: true })).toEqual({
    clockHighWater: 1100, clockFenced: false, cancelRequested: true, cancelRequestedAt: 1100, cancelReason: 'cancelled', immediateStop: false });
  expect(await journal.supervision({ key: f.key(), now: 3000, cancel: true })).toMatchObject({ cancelRequestedAt: 1100 });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.supervision({ key: f.key(), now: 2000 })).toEqual({
    clockHighWater: 3000, clockFenced: true, cancelRequested: true, cancelRequestedAt: 1100, cancelReason: 'cancelled', immediateStop: false });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.supervision({ key: f.key(), now: 5000, cancel: true })).toEqual({
    clockHighWater: 5000, clockFenced: true, cancelRequested: true, cancelRequestedAt: 1100, cancelReason: 'cancelled', immediateStop: false });
});

it('anchors public durable cancel in its own worker transaction and never resets it', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer());
  const before = Date.now(); await journal.durableCancel(f.key()); const after = Date.now();
  const first = await journal.supervision({ key: f.key(), now: after });
  expect(first.cancelRequestedAt).toBeGreaterThanOrEqual(before);
  expect(first.cancelRequestedAt).toBeLessThanOrEqual(after);
  expect(first.clockFenced).toBe(false);
  await journal.durableCancel(f.key());
  expect((await journal.supervision({ key: f.key(), now: Date.now() })).cancelRequestedAt).toBe(first.cancelRequestedAt);
});

it('rejects cross-scope and stale generation before changing clock or cancel intent', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer());
  for (const key of [{ ...f.key(), generation: 2 }, { ...f.key(), organizationId: '00000000-0000-4000-8000-000000000999' }]) {
    await expect(journal.supervision({ key, now: 9999, cancel: true })).rejects.toMatchObject({ code:
      key.generation === 2 ? 'stale_generation' : 'not_found' });
  }
  expect(await journal.supervision({ key: f.key(), now: 1 })).toMatchObject({
    clockHighWater: 1, clockFenced: false, cancelRequestedAt: null, cancelRequested: false });
});

it.each([-1, 0.5, NaN, Infinity, 8_640_000_000_000_001])('rejects invalid trusted wall time %s before I/O', async now => {
  const journal = await f.open(); await journal.immutableOffer(f.offer());
  await expect(journal.supervision({ key: f.key(), now, cancel: true })).rejects.toMatchObject({ code: 'invalid_input' });
  expect((await journal.get(f.key())).cancelRequested).toBe(false);
});

it('uses persisted admission time as an initial lower clock bound and atomically retires queued work', async () => {
  const journal = await a.configured(); const offer = a.job(); await a.enqueue(journal, offer);
  const result = await journal.supervision({ key: scope(offer), now: now - 1, cancel: true });
  expect(result).toMatchObject({ clockHighWater: now, clockFenced: true, cancelRequestedAt: now });
  expect(await a.admit(journal, offer)).toMatchObject({ kind: 'reject', reason: 'cancelled' });
  await expect(journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: 'b'.repeat(64) }))
    .rejects.toMatchObject({ code: 'not_found' });
});

it('blocks create/start claims after supervised cancellation without releasing charged capacity', async () => {
  const journal = await a.configured(); const offer = a.job(); await a.enqueue(journal, offer); await a.admit(journal, offer);
  await journal.supervision({ key: scope(offer), now: now + 1, cancel: true });
  await expect(journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: 'b'.repeat(64) }))
    .rejects.toMatchObject({ code: 'conflict' });
  expect(reserved(await journal.admission({ kind: 'reservation', key: scope(offer) })).status).toBe('charged');
});

it.each([8_640_000_000_000_001, Number.MAX_SAFE_INTEGER])('preserves cancel intent for prior admitted clock %s beyond Date range', async high => {
  const path = a.path(); let journal = await a.configured(path); const offer = a.job();
  expect(await a.enqueue(journal, offer, high)).toMatchObject({ kind: 'defer', reason: 'queued' });
  await journal.durableCancel(scope(offer));
  expect((await journal.get(scope(offer))).cancelRequested).toBe(true);
  await a.close(journal); journal = await a.open(path);
  expect(await journal.supervision({ key: scope(offer), now: Date.now() })).toEqual({
    clockHighWater: high, clockFenced: true, cancelRequested: true, cancelRequestedAt: high, cancelReason: 'cancelled', immediateStop: false });
  expect(await a.admit(journal, offer, Date.now())).toMatchObject({ kind: 'reject', reason: 'cancelled' });
});

it('rolls back cancel and queued-work retirement when the final clock write fails', async () => {
  const path = a.path(); let journal = await a.configured(path); const offer = a.job(); await a.enqueue(journal, offer);
  await a.close(journal);
  edit(path, "CREATE TRIGGER fail_clock BEFORE INSERT ON supervision_clock BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
  journal = await a.open(path);
  await expect(journal.supervision({ key: scope(offer), now: now + 1, cancel: true })).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort(); edit(path, 'DROP TRIGGER fail_clock'); journal = await a.open(path);
  expect((await journal.get(scope(offer))).cancelRequested).toBe(false);
  await journal.admission({ kind: 'observe', observation: observation(now + 2) });
  expect(await a.admit(journal, offer, now + 2)).toMatchObject({ status: 'charged', admittedAt: now + 2 });
});

it('migrates v3 additively, preserving evidence and fencing an unanchored old cancellation', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
  await journal.appendWrapper(f.wrapper()); await journal.durableCancel(f.key()); await f.close(journal);
  edit(path, 'DROP TABLE journal_authority; DROP TABLE supervision_clock; ALTER TABLE accepted_attempts DROP COLUMN checkpoint_bytes; '
    + 'ALTER TABLE accepted_attempts DROP COLUMN wrapper_checkpoint_json; ALTER TABLE accepted_attempts DROP COLUMN phase;\n'
    + 'ALTER TABLE accepted_attempts DROP COLUMN exit_json; ALTER TABLE accepted_attempts DROP COLUMN result_json;\n'
    + 'ALTER TABLE accepted_attempts DROP COLUMN exit_facts_json; ALTER TABLE accepted_attempts DROP COLUMN snapshot_bytes; PRAGMA user_version=3;');
  journal = await f.open(path);
  expect(await journal.supervision({ key: f.key(), now: 1234, cancel: true })).toEqual({
    clockHighWater: 1234, clockFenced: true, cancelRequested: true, cancelRequestedAt: null, cancelReason: null, immediateStop: false });
  expect((await journal.readEvents(f.key(), 0)).events).toHaveLength(1);
});

it('rolls back failed migration004 without touching existing data', async () => {
  const path = f.path(); const journal = await f.open(path); await journal.immutableOffer(f.offer()); await f.close(journal);
  edit(path, 'PRAGMA user_version=3;');
  await expect(f.open(path)).rejects.toMatchObject({ code: 'unavailable' });
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
    expect(db.prepare('SELECT count(*) AS count FROM accepted_attempts').get()?.count).toBe(1);
  } finally { db.close(); }
});
