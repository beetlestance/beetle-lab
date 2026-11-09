import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimsFixture, custody } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { createInput } from './inputs-fixture.js';

let f: ClaimsFixture;
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });
it('enforces active isolated ownership installation-wide and requires zero active charges', () => {
  const isolated = f.add(70, 'isolated'); const parallel = f.addOther();
  expect(f.claims.claim(isolated).kind).toBe('claimed');
  expect(f.claims.claim(parallel)).toEqual({ kind: 'blocked', reason: 'isolated' });
  f.release(isolated);
  expect(f.claims.claim(parallel).kind).toBe('claimed');
  const next = f.add(73, 'isolated');
  expect(f.claims.claim(next)).toEqual({ kind: 'blocked', reason: 'isolated' });
});
it('finds the feasible isolated predecessor beyond page32 while older parallel work progresses', () => {
  const older = f.add();
  for (let n = 0; n < 32; n++) f.add(1000 + n * 2);
  const isolated = f.add(2000, 'isolated'); const younger = f.add(2002);
  expect(f.claims.scan({ lane: 'queued', limit: 32 }).items.some(row => row.key.runId === isolated.runId)).toBe(false);
  expect(f.claims.claim(older).kind).toBe('claimed');
  expect(f.claims.claim(younger)).toEqual({ kind: 'blocked', reason: 'isolated_predecessor' });
});
it('recomputes a newly feasible predecessor in the claim transaction after advisory scan', () => {
  const isolated = f.add(70, 'isolated', 500); const younger = f.add(71);
  f.policy(values => { values.perRunCeilings.cpuMillis = 200; });
  expect(f.claims.scan({ lane: 'queued', limit: 32 }).items[1]!.eligibility).toEqual({ kind: 'ready' });
  f.policy(values => { values.perRunCeilings.cpuMillis = 1000; });
  const before = custody(f.db);
  expect(f.claims.claim(younger)).toEqual({ kind: 'blocked', reason: 'isolated_predecessor' });
  expect(custody(f.db)).toEqual(before);
  expect(f.claims.claim(isolated).kind).toBe('claimed');
});
it('ignores individually impossible isolated work without subtracting active occupancy for barrier fit', () => {
  const active = f.add(); const isolated = f.add(71, 'isolated', 500); const young = f.add(72);
  expect(f.claims.claim(active).kind).toBe('claimed');
  f.policy(values => { values.perRunCeilings.cpuMillis = 200; });
  expect(f.claims.claim(young).kind).toBe('claimed');
  f.release(young);
  const another = f.add(73);
  f.policy(values => { values.perRunCeilings.cpuMillis = 1000; values.pool.cpuMillis = 500; });
  expect(f.claims.claim(young)).toEqual({ kind: 'acknowledged' });
  expect(f.claims.claim(another)).toEqual({ kind: 'blocked', reason: 'isolated_predecessor' });
  expect(f.claims.claim(isolated)).toEqual({ kind: 'blocked', reason: 'isolated' });
});
it('does not establish an isolation barrier for currently storage-blocked originals', () => {
  f.add(70, 'isolated', 100, 1000); const younger = f.add(71);
  f.policy(values => { values.pool.storageBytes = 68000; });
  expect(f.claims.scan({ lane: 'queued', limit: 32 }).items[0]!.eligibility).toEqual({ kind: 'blocked', reason: 'storage_unavailable' });
  expect(f.claims.claim(younger).kind).toBe('claimed');
});
it('obeys current profile digest, per-run, staging, pool and concurrency ceilings without mutation', () => {
  const key = f.add();
  const before = custody(f.db);
  f.policy(values => { values.supportedProfiles = ['isolated']; });
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'profile_unavailable' });
  f.policy(values => { values.supportedProfiles = ['standard', 'isolated']; values.perRunCeilings.cpuMillis = 50; });
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'per_run_ceiling' });
  f.policy(values => { values.perRunCeilings.cpuMillis = 1000; values.pool.cpuMillis = 50; });
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'budget_unavailable' });
  expect(custody(f.db)).toEqual(before);
});
it('subtracts the one complete observation staging pool and applies per-run staging limits', () => {
  const first = f.add(); const second = f.add(71);
  const row = f.db.prepare('SELECT staging_bytes FROM execution_intents WHERE attempt_id=?').get(first.attempt.attemptId)!;
  const staging = Number(row.staging_bytes);
  f.runtime.execution = { stagingBytes: staging, perRunStagingBytes: staging };
  vi.advanceTimersByTime(1);
  f.settings.updateRuntime({ ...f.runtime, observedAtMs: Date.now(), expiresAtMs: Date.now() + 5000 });
  expect(f.claims.claim(first).kind).toBe('claimed');
  expect(f.claims.claim(second)).toEqual({ kind: 'blocked', reason: 'staging_unavailable' });
  f.release(first);
  f.runtime.execution = { stagingBytes: staging, perRunStagingBytes: staging - 1 };
  vi.advanceTimersByTime(1);
  f.settings.updateRuntime({ ...f.runtime, observedAtMs: Date.now(), expiresAtMs: Date.now() + 5000 });
  expect(f.claims.claim(second)).toEqual({ kind: 'blocked', reason: 'staging_unavailable' });
});
it('retained input allowances share the same current quota and exact storage boundary', () => {
  const key = f.add();
  f.store.execute({ kind: 'input', command: createInput(90, 10000) });
  const usage = Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes);
  f.policy(values => { values.pool.storageBytes = usage + 67635; });
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'storage_unavailable' });
  f.policy(values => { values.pool.storageBytes = usage + 67636; });
  expect(f.claims.claim(key).kind).toBe('claimed');
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(usage + 65636);
});
