import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DispatchClaims } from '../../src/adapters/outbound/sqlite/dispatch-claims.js';
import { snapshotFor } from './execution-foundation-fixtures.js';
import { claimsFixture, custody } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';

let f: ClaimsFixture;
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });
it('claims atomically and replays the exact original without charge, clock or version changes', () => {
  const original = f.original();
  expect(f.claims.readOffer(original.key)).toEqual({ key: original.key, offer: original.offer });
  expect(f.claims.claim(original.key)).toEqual({ kind: 'claimed', key: original.key });
  expect(f.reads.get({ id: original.key.runId, scope: original.run.scope })).toMatchObject({ state: 'dispatching', version: 2 });
  const before = custody(f.db);
  vi.advanceTimersByTime(6000);
  f.policy(values => { values.pool.cpuMillis = 1; values.supportedProfiles = ['isolated']; });
  const lowered = custody(f.db);
  const drifted = new DispatchClaims(f.db, f.settings, { ...f.config, profiles: [] });
  expect(drifted.claim(original.key)).toEqual({ kind: 'replay', key: original.key });
  expect(drifted.readOffer(original.key)).toEqual({ key: original.key, offer: original.offer });
  expect(custody(f.db)).toEqual(lowered);
  expect(before).toEqual(lowered);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('acknowledged originals forbid PUT and remain discoverable after terminal Run and source expiry', () => {
  const key = f.add();
  f.claims.claim(key);
  f.release(key);
  f.db.exec("UPDATE runs SET state='errored',outcome='inconclusive',reason='engine_crash'");
  vi.advanceTimersByTime(6000);
  const before = custody(f.db);
  expect(f.claims.claim(key)).toEqual({ kind: 'acknowledged' });
  expect(custody(f.db)).toEqual(before);
  expect(f.claims.scan({ lane: 'reconcile', limit: 32 }).items).toEqual([]);
});
it('reconciliation retains charged ACKs independently of profile/source and terminal public state', () => {
  const key = f.add(); f.claims.claim(key);
  f.observations.observe({ key, snapshot: snapshotFor(key) });
  f.db.exec("UPDATE runs SET state='errored',outcome='inconclusive',reason='engine_crash'");
  vi.advanceTimersByTime(6000);
  const drift = new DispatchClaims(f.db, f.settings, { ...f.config, profiles: [] });
  expect(drift.scan({ lane: 'reconcile', limit: 32 }).items[0]).toMatchObject({ key, eligibility: { kind: 'ready' } });
  expect(drift.claim(key)).toEqual({ kind: 'acknowledged' });
});
it('uses shared storage exactly once and retained output prevents later work after execution release', () => {
  const first = f.add(); const second = f.add(71); const third = f.add(72);
  expect(f.claims.claim(first).kind).toBe('claimed');
  expect(f.claims.claim(second).kind).toBe('claimed');
  f.release(first); f.release(second);
  f.policy(values => { values.pool.storageBytes = 140000; });
  const before = custody(f.db);
  expect(f.claims.claim(third)).toEqual({ kind: 'blocked', reason: 'storage_unavailable' });
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(131272);
  expect(custody(f.db)).toEqual(before);
});
it.each(['cancelled', 'closed'] as const)('refuses fresh %s Run without mutation', kind => {
  const key = f.add();
  if (kind === 'cancelled') f.db.exec('UPDATE runs SET cancellation_requested=1');
  else f.db.exec("UPDATE runs SET state='errored',outcome='inconclusive',reason='engine_crash'");
  const before = custody(f.db);
  expect(f.claims.claim(key)).toEqual({ kind: 'blocked', reason: 'not_queued' });
  expect(custody(f.db)).toEqual(before);
});
it('returns immutable Offer copies without resolving current defaults', () => {
  const original = f.original();
  const value = f.claims.readOffer(original.key);
  value.offer.budget.cpuMillis = 999;
  expect(f.claims.readOffer(original.key).offer).toEqual(original.offer);
  f.claims.claim(original.key);
  f.observations.observe({ key: original.key, snapshot: snapshotFor(original.key) });
  expect(f.claims.readOffer(original.key).offer).toEqual(original.offer);
});
