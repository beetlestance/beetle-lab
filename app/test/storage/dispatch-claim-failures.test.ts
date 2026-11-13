import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DispatchClaims } from '../../src/adapters/outbound/sqlite/dispatch-claims.js';
import { claimsFixture, custody, makeLegacy } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { uuid } from './fixture.js';
import { reserveAndMark } from './execution-foundation-fixtures.js';

let f: ClaimsFixture;
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });
it('refuses unknown source and rolls back an expired original lease after all writes', () => {
  const key = f.add();
  const before = custody(f.db);
  const original = f.settings.capacity.bind(f.settings);
  let calls = 0;
  vi.spyOn(f.settings, 'capacity').mockImplementation(() => {
    calls++;
    if (calls === 2) {
      expect(f.db.prepare('SELECT count(*) n FROM execution_records').get()?.n).toBe(1);
      expect(f.db.prepare('SELECT possible_delivery FROM dispatch_outbox').get()?.possible_delivery).toBe(1);
      expect(f.db.prepare('SELECT state FROM runs').get()?.state).toBe('dispatching');
      vi.advanceTimersByTime(6000);
    }
    return original();
  });
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'capacity_unknown' });
  expect(custody(f.db)).toEqual(before);
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'capacity_unknown' });
  expect(custody(f.db)).toEqual(before);
});
it.each(['revocation', 'rollback'] as const)('rolls back on original observation %s before commit', failure => {
  const key = f.add(); const before = custody(f.db);
  const original = f.settings.capacity.bind(f.settings);
  let calls = 0;
  vi.spyOn(f.settings, 'capacity').mockImplementation(() => {
    if (++calls === 2) {
      if (failure === 'revocation') f.settings.updateRuntime(null);
      else vi.setSystemTime(Date.now() - 1);
    }
    return original();
  });
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'capacity_unknown' });
  expect(custody(f.db)).toEqual(before);
});
it('rolls back late SQL failure and version exhaustion without leaving reservations', () => {
  const key = f.add(); const before = custody(f.db);
  f.db.exec("CREATE TRIGGER late_failure BEFORE UPDATE OF state ON runs BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END;");
  expect(() => f.claims.claim(key)).toThrow('synthetic late failure');
  expect(custody(f.db)).toEqual(before);
  f.db.exec('DROP TRIGGER late_failure; UPDATE runs SET version=9007199254740991');
  const exhausted = custody(f.db);
  expect(() => f.claims.claim(key)).toThrow();
  expect(custody(f.db)).toEqual(exhausted);
  expect(f.db.isTransaction).toBe(false);
});
it('binds every exact key field and rejects closed/accessor inputs before reading them', () => {
  const key = f.add(); const before = custody(f.db);
  for (const field of ['attemptId', 'organizationId', 'workspaceId', 'intentDigest'] as const) {
    const value = field === 'intentDigest' ? '0'.repeat(64) : uuid(999);
    const wrong = { ...key, attempt: { ...key.attempt, [field]: value } };
    expect(f.claims.claim(wrong)).toEqual({ kind: 'blocked', reason: 'not_queued' });
    expect(() => f.claims.readOffer(wrong)).toThrow();
  }
  expect(f.claims.claim({ ...key, runId: uuid(998) })).toEqual({ kind: 'blocked', reason: 'not_queued' });
  expect(() => f.claims.claim({ ...key, attempt: { ...key.attempt, generation: 2 } } as never)).toThrow();
  expect(() => f.claims.claim({ ...key, extra: true } as never)).toThrow();
  const getter = vi.fn();
  expect(() => f.claims.claim({ get runId() { getter(); return key.runId; }, attempt: key.attempt })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(custody(f.db)).toEqual(before);
});
it('rejects noncanonical persisted Offer and overbound original text before returning it', () => {
  const key = f.add();
  f.db.exec('DROP TRIGGER attempts_intent_immutable');
  f.db.prepare("UPDATE attempts SET offer_json=offer_json||' '").run();
  expect(() => f.claims.readOffer(key)).toThrow();
  f.db.exec('PRAGMA ignore_check_constraints=ON');
  f.db.prepare('UPDATE attempts SET offer_json=?').run(' '.repeat(2097153));
  expect(() => f.claims.readOffer(key)).toThrow();
});
it('rejects changed registry digest and unsafe output arithmetic', () => {
  const key = f.add();
  const config = structuredClone(f.config);
  config.profiles[0]!.engine.imageDigest = `sha256:${'d'.repeat(64)}`;
  expect(new DispatchClaims(f.db, f.settings, config).claim(key)).toEqual({ kind: 'blocked', reason: 'profile_unavailable' });
  f.db.exec('DROP TRIGGER execution_intent_immutable');
  f.db.prepare('UPDATE execution_intents SET output_bytes=9007199254740991').run();
  const before = custody(f.db);
  expect(() => f.claims.claim(key)).toThrow('Storage unavailable');
  expect(custody(f.db)).toEqual(before);
});

it.each(['possible', 'acknowledged'] as const)('fences terminal untracked %s ownership while preserving diagnostics', kind => {
  const legacy = f.add(); const fresh = f.add(71);
  makeLegacy(f.db, legacy);
  if (kind === 'possible') {
    f.db.exec('DROP TRIGGER cleanup_control_delivery; DROP TRIGGER outbox_requires_reservation');
    f.db.prepare("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00Z' WHERE attempt_id=?")
      .run(legacy.attempt.attemptId);
  } else {
    f.db.prepare('UPDATE attempts SET generation=1 WHERE id=?').run(legacy.attempt.attemptId);
    f.db.exec('DROP TRIGGER outbox_retain_untracked');
    f.db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(legacy.attempt.attemptId);
  }
  f.db.prepare("UPDATE runs SET state='errored',outcome='inconclusive',reason='engine_crash' WHERE id=?").run(legacy.runId);
  const before = custody(f.db);
  expect(f.claims.claim(fresh)).toEqual({ kind: 'blocked', reason: 'ownership_unknown' });
  expect(f.claims.claim(legacy)).toEqual({ kind: 'blocked', reason: 'untracked_intent' });
  expect(custody(f.db)).toEqual(before);
});
it('reports unpublished untracked diagnostic order zero with attempt tie continuation and no claim authority', () => {
  const legacy = f.add(); const fresh = f.add(71); makeLegacy(f.db, legacy);
  const page = f.claims.scan({ lane: 'queued', limit: 1 });
  expect(page.items[0]).toMatchObject({ key: legacy, order: 0, eligibility: { kind: 'blocked', reason: 'untracked_intent' } });
  expect(f.claims.scan({ lane: 'queued', limit: 1, cursor: page.items[0]!.after }).items[0]!.key).toEqual(fresh);
  expect(f.claims.claim(legacy)).toEqual({ kind: 'blocked', reason: 'untracked_intent' });
});
it('retains exactly 64 active original charges and refuses excess or inconsistent recovery sums', () => {
  f.db.close(); f=claimsFixture(10000000);
  const keys = Array.from({ length: 66 }, (_, n) => f.add(1000 + n * 2));
  const pool = { cpuMillis: 10000, memoryBytes: 10000, pids: 10000, outputBytes: 10000,
    concurrency: 100, storageBytes: 10000000, freeSpaceReserveBytes: 0 };
  f.policy(values => { values.pool = pool; });
  f.runtime.ceilings.pool = pool;
  vi.advanceTimersByTime(1);
  f.settings.updateRuntime({ ...f.runtime, observedAtMs: Date.now(), expiresAtMs: Date.now() + 5000 });
  for (const key of keys.slice(0, 64)) expect(f.claims.claim(key).kind).toBe('claimed');
  expect(f.claims.claim(keys[64]!)).toEqual({ kind: 'blocked', reason: 'budget_unavailable' });
  expect(f.claims.scan({ lane: 'reconcile', limit: 32 }).items).toHaveLength(32);
  expect(f.db.prepare('SELECT count(*) n FROM execution_records WHERE execution_charged=1').get()?.n).toBe(64);
  f.db.exec('DROP TRIGGER execution_intent_immutable');
  f.db.prepare('UPDATE execution_intents SET cpu_millis=9007199254740991 WHERE attempt_id=?').run(keys[0]!.attempt.attemptId);
  const before = custody(f.db);
  expect(() => f.claims.claim(keys[64]!)).toThrow('Storage unavailable');
  expect(custody(f.db)).toEqual(before);
});
it('refuses a 65th charged recovery row before policy interpretation', () => {
  f.db.close(); f=claimsFixture(10000000);
  const keys = Array.from({ length: 65 }, (_, n) => f.add(1000 + n * 2));
  f.db.exec('DROP TRIGGER execution_record_insert');
  f.db.exec('BEGIN IMMEDIATE');
  for (const key of keys) reserveAndMark(f.db, key);
  f.db.exec('COMMIT');
  expect(() => f.claims.scan({ lane: 'reconcile', limit: 1 })).toThrow('Storage unavailable');
  const fresh = f.add(2000);
  const before = custody(f.db);
  expect(() => f.claims.claim(fresh)).toThrow('Storage unavailable');
  expect(custody(f.db)).toEqual(before);
});

it('fails closed on inconsistent retained custody without replacing or releasing the original', () => {
  const key = f.add(); f.claims.claim(key);
  f.db.exec('DROP TRIGGER output_immutable');
  f.db.prepare('UPDATE attempt_output_allocations SET maximum_payload_bytes=101,charged_bytes=65637 WHERE attempt_id=?')
    .run(key.attempt.attemptId);
  const before = custody(f.db);
  expect(() => f.claims.claim(key)).toThrow('Storage unavailable');
  expect(custody(f.db)).toEqual(before);
});
