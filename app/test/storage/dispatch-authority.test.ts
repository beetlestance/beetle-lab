import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimsFixture, custody } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { snapshotFor } from './execution-foundation-fixtures.js';
import { captureDispatchOperation, captureDispatchReply } from '../../src/adapters/outbound/sqlite/dispatch-wire.js';
import type { DispatchOperation } from '../../src/adapters/outbound/sqlite/dispatch-wire.js';

const other = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
let f: ClaimsFixture;
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });
it('pins first delivery and retains the original authority across capability rotation, ACK and expiry', () => {
  const key = f.add(); const authority = f.runtime.journalAuthority;
  expect(f.claims.claim(key)).toEqual({ kind: 'claimed', key, journalAuthority: authority });
  expect(f.db.prepare('SELECT journal_authority FROM execution_records').get()).toEqual({ journal_authority: authority });
  vi.advanceTimersByTime(1);
  f.settings.updateRuntime({ ...f.runtime, journalAuthority: other, observedAtMs: Date.now(), expiresAtMs: Date.now() + 5000 });
  expect(f.claims.claim(key)).toEqual({ kind: 'replay', key, journalAuthority: authority });
  const before = custody(f.db);
  expect(() => f.observations.observe({ key, journalAuthority: other, snapshot: snapshotFor(key,
    { admission: { state: 'released', disposition: 'settled' } }) })).toThrow();
  expect(custody(f.db)).toEqual(before);
  f.observations.observe({ key, journalAuthority: authority, snapshot: snapshotFor(key) });
  expect(f.db.prepare('SELECT * FROM dispatch_outbox').all()).toEqual([]);
  vi.advanceTimersByTime(6000);
  expect(f.claims.claim(key)).toEqual({ kind: 'acknowledged', journalAuthority: authority });
  const acknowledged = custody(f.db);
  expect(() => f.observations.observe({ key, journalAuthority: other, snapshot: snapshotFor(key,
    { lastSeq: 2, admission: { state: 'released', disposition: 'settled' } }) })).toThrow();
  expect(custody(f.db)).toEqual(acknowledged);
  f.observations.observe({ key, journalAuthority: authority, snapshot: snapshotFor(key,
    { lastSeq: 2, admission: { state: 'released', disposition: 'settled' } }) });
  expect(f.db.prepare('SELECT execution_charged,journal_authority FROM execution_records').get())
    .toEqual({ execution_charged: 0, journal_authority: authority });
});
it('refuses SQL authority rotation or erasure without changing any custody', () => {
  const key = f.add(); f.claims.claim(key); const before = custody(f.db);
  for (const value of [other, null]) {
    expect(() => f.db.prepare('UPDATE execution_records SET journal_authority=?').run(value)).toThrow();
    expect(custody(f.db)).toEqual(before);
  }
  expect(() => f.db.exec('INSERT OR REPLACE INTO execution_records SELECT * FROM execution_records')).toThrow();
  expect(custody(f.db)).toEqual(before);
});
it('validates physical authority at both RPC edges independently of logical snapshot identity', () => {
  const key = f.add(); const snapshot = snapshotFor(key); const journalAuthority = f.runtime.journalAuthority;
  const operation: DispatchOperation = { kind: 'dispatchObserve', request: { key, snapshot, journalAuthority } };
  expect(captureDispatchOperation(operation)).toEqual(operation);
  const claim: DispatchOperation = { kind: 'dispatchClaim', key };
  for (const invalid of [undefined, null, '', other.toUpperCase(), `urn:uuid:${other}`]) {
    const request = { key, snapshot, ...(invalid === undefined ? {} : { journalAuthority: invalid }) };
    expect(() => captureDispatchOperation({ kind: 'dispatchObserve', request } as DispatchOperation)).toThrow();
    for (const kind of ['claimed', 'replay', 'acknowledged']) {
      const value = { kind, ...(kind === 'acknowledged' ? {} : { key }), ...(invalid === undefined ? {} : { journalAuthority: invalid }) };
      expect(() => captureDispatchReply(claim, value)).toThrow();
    }
  }
});
it.each([null, '', 'bad', other.toUpperCase(), `urn:uuid:${other}`, other.replaceAll('-', ''), `${other}\0suffix`, `${other}\0`])(
  'rejects noncanonical newly inserted SQL authority before reservation custody: %s', journalAuthority => {
    const key = f.add(); const before = custody(f.db);
    expect(() => f.db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,
      workspace_id,intent_digest,delivery_attempt_id,output_attempt_id,journal_authority)
      SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,attempt_id,attempt_id,?
      FROM execution_intents WHERE attempt_id=?`).run(journalAuthority, key.attempt.attemptId))
      .toThrow(/CHECK constraint failed|new delivery requires journal authority/);
    expect(custody(f.db)).toEqual(before);
  });
it('rolls back all custody when journal authority rotates during the post-reservation lease check', () => {
  const key = f.add(); const before = custody(f.db);
  const capacity = f.settings.capacity.bind(f.settings); let reads = 0;
  const injected = vi.spyOn(f.settings, 'capacity').mockImplementation(() => {
    reads++;
    if (reads === 2) {
      vi.advanceTimersByTime(1);
      f.settings.updateRuntime({ ...f.runtime, journalAuthority: other,
        observedAtMs: Date.now(), expiresAtMs: Date.now() + 5000 });
    }
    return capacity();
  });
  try {
    expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'capacity_unknown' });
    expect(reads).toBe(2); expect(custody(f.db)).toEqual(before);
  } finally { injected.mockRestore(); }
  expect(f.claims.claim(key)).toEqual({ kind: 'claimed', key, journalAuthority: other });
});
