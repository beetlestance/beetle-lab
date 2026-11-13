import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DISK_HOLD_METADATA_BYTES } from '../../src/admission/index.js';
import type { LaunchSettlement, ReleaseEvidence } from '../../src/admission/index.js';
import { diskRetention } from '../../src/journal/disk-retention/facts.js';
import { acknowledge, prune } from '../../src/journal/replay.js';
import { configuration, job, native, now, reserved, scope, stats } from './fixtures.js';

it('reserves exactly one immutable row, slot and quota charge on actual admission and replay', () => {
  const f = native(); const a = job(); f.enqueue(a);
  expect(stats(f.db)).toMatchObject({ held_count: 0 });
  expect(f.db.prepare('SELECT hold_bytes FROM accepted_attempts').get()?.hold_bytes).toBe(0);
  const first = reserved(f.admit(a)); expect(f.admit(a)).toEqual(first); expect(f.enqueue(a)).toEqual(first);
  expect({ ...f.db.prepare('SELECT * FROM disk_holds').get() }).toEqual({
    attempt_id: a.attemptId, organization_id: a.organizationId, workspace_id: a.workspaceId, generation: 1,
    intent_digest: a.intentDigest, output_bytes: a.budget.outputBytes, staging_bytes: first.staging.totalBytes,
    metadata_bytes: DISK_HOLD_METADATA_BYTES, phase: 'active' });
  expect(stats(f.db)).toEqual({ id: 1, held_count: 1, held_output_bytes: 100, held_staging_bytes: first.staging.totalBytes,
    retained_output_bytes: 0, retained_staging_bytes: 0 });
  expect(f.db.prepare('SELECT hold_bytes FROM accepted_attempts').get()?.hold_bytes).toBe(512);
});
it('keeps staging written before abort and transfers output and staging exactly once on abort replay', () => {
  const f = native(); const a = job(); f.enqueue(a); const original = reserved(f.admit(a));
  const root = mkdtempSync(join(tmpdir(), 'beetle-disk-retention-'));
  try {
    const input = join(root, `${a.attemptId}.input`); writeFileSync(input, Buffer.alloc(1024, 7));
    const released = f.abort(a); expect(f.abort(a)).toEqual(released); expect(f.admit(a)).toEqual(released);
    expect(readFileSync(input)).toEqual(Buffer.alloc(1024, 7));
  } finally { rmSync(root, { recursive: true, force: true }); }
  expect(stats(f.db)).toEqual({ id: 1, held_count: 1, held_output_bytes: 100, held_staging_bytes: original.staging.totalBytes,
    retained_output_bytes: 100, retained_staging_bytes: original.staging.totalBytes });
  expect(diskRetention(f.db)).toEqual({ replayBytes:0, heldCount: 1, outputBytes: 100, stagingBytes: original.staging.totalBytes });
  expect(f.db.prepare('SELECT charged FROM reservations').get()?.charged).toBe(0);
  expect(f.db.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('retained');
});
it('transfers both disk amounts on settled release, including failed collection and lost-reply replay', () => {
  const f = native(); const a = job(); f.enqueue(a); const original = reserved(f.admit(a));
  const create = f.store.execute({ kind: 'claimCreate', key: scope(a), specDigest: 'b'.repeat(64) });
  if (!('token' in create)) throw new Error('claim');
  const binding = { key: scope(a), createToken: create.token, specDigest: 'b'.repeat(64), runtimeId: 'synthetic-runtime' };
  f.store.execute({ kind: 'bindRuntime', ...binding });
  const settlement: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 0, startToken: null,
    disposition: 'retired', settledAt: now + 1, evidenceId: 'retired' };
  f.store.execute({ kind: 'settleLaunch', settlement });
  const evidence: ReleaseEvidence = { authority: 'supervisor', ...binding,
    launch: { epoch: 0, startToken: null, settlementId: 'retired' },
    runtime: { state: 'absent', source: 'supervisor', observedAt: now + 2, evidenceId: 'absent' },
    collection: { state: 'failed', observedAt: now + 2, evidenceId: 'failed' } };
  f.db.exec("CREATE TRIGGER fail_release AFTER UPDATE ON disk_holds BEGIN SELECT RAISE(ABORT,'late release'); END");
  expect(() => f.store.execute({ kind: 'release', evidence })).toThrow('late release');
  expect(stats(f.db)).toMatchObject({ retained_output_bytes: 0, retained_staging_bytes: 0 });
  expect(f.db.prepare('SELECT charged FROM reservations').get()?.charged).toBe(1);
  f.db.exec('DROP TRIGGER fail_release');
  const first = f.store.execute({ kind: 'release', evidence });
  expect(f.store.execute({ kind: 'release', evidence })).toEqual(first);
  expect(diskRetention(f.db)).toEqual({ replayBytes:0, heldCount: 1, outputBytes: 100, stagingBytes: original.staging.totalBytes });
});
it('rolls back every reservation, hold, counter and charge on late admission and release failures', () => {
  const f = native(); const a = job(); f.enqueue(a);
  f.db.exec("CREATE TRIGGER fail_admitted BEFORE INSERT ON event_spool BEGIN SELECT RAISE(ABORT,'late append'); END");
  expect(() => f.admit(a)).toThrow('late append');
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM reservations').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM disk_holds').get()?.n).toBe(0);
  expect(stats(f.db)).toMatchObject({ held_count: 0 });
  expect(f.db.prepare('SELECT hold_bytes,last_seq FROM accepted_attempts').get()).toMatchObject({ hold_bytes: 0, last_seq: 0 });
  expect(f.db.prepare('SELECT pending FROM admission_queue').get()?.pending).toBe(1);
  f.db.exec('DROP TRIGGER fail_admitted'); f.admit(a);
  f.db.exec("CREATE TRIGGER fail_retained AFTER UPDATE ON disk_holds BEGIN SELECT RAISE(ABORT,'late retain'); END");
  expect(() => f.abort(a)).toThrow('late retain');
  expect(stats(f.db)).toMatchObject({ held_count: 1, retained_output_bytes: 0, retained_staging_bytes: 0 });
  expect(f.db.prepare('SELECT charged FROM reservations').get()?.charged).toBe(1);
  expect(f.db.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('active');
});
it('keeps hold metadata charged through ACK pruning and denies quota shortfall/refund', () => {
  const f = native(); const a = job(); f.enqueue(a); f.admit(a); f.abort(a);
  acknowledge(f.db, { ...scope(a), protocolVersion: '1.0', throughSeq: 1 });
  expect(prune(f.db, scope(a)).pruned).toBe(1);
  expect(f.db.prepare('SELECT spool_bytes FROM accepted_attempts').get()?.spool_bytes).toBe(0);
  for (const query of ['UPDATE accepted_attempts SET hold_bytes=0',
    'UPDATE accepted_attempts SET quota_bytes=spool_bytes+snapshot_bytes+checkpoint_bytes+511']) expect(() => f.db.exec(query)).toThrow();
  expect(f.db.prepare('SELECT hold_bytes FROM accepted_attempts').get()?.hold_bytes).toBe(512);
});
it('preserves debt and replay under lower settings while releasing native CPU, concurrency and isolation', () => {
  const f = native(); const a = job(); a.budget.cpuMillis = 3000; a.executionPolicy.mode = 'isolated';
  const config = configuration(); config.maxConcurrent = 1;
  f.store.execute({ kind: 'configure', configuration: config }); f.enqueue(a); f.admit(a); const released = f.abort(a);
  const b = job(2); b.budget.cpuMillis = 3000; b.executionPolicy.mode = 'isolated'; f.enqueue(b);
  config.pool.outputBytes = 100;
  f.store.execute({ kind: 'configure', configuration: config });
  expect(f.admit(a)).toEqual(released);
  expect(f.admit(b)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
  expect(stats(f.db)).toMatchObject({ held_count: 1, retained_output_bytes: 100 });
  config.pool.outputBytes = 200; f.store.execute({ kind: 'configure', configuration: config });
  expect(f.admit(b)).toMatchObject({ status: 'charged', mode: 'isolated' });
  expect(f.db.prepare('SELECT SUM(charged) AS n FROM reservations').get()?.n).toBe(1);
  expect(stats(f.db)).toMatchObject({ held_count: 2, held_output_bytes: 200, retained_output_bytes: 100 });
});
it('rejects missing durable facts and direct counter, identity, phase, REPLACE, delete and FK mutation', () => {
  const f = native(); const a = job(); f.enqueue(a); f.admit(a);
  for (const query of [
    'UPDATE disk_retention_stats SET held_count=0', 'DELETE FROM disk_retention_stats',
    'INSERT OR REPLACE INTO disk_retention_stats SELECT * FROM disk_retention_stats',
    'UPDATE disk_holds SET output_bytes=1', "UPDATE disk_holds SET phase='retained'", 'DELETE FROM disk_holds',
    'INSERT OR REPLACE INTO disk_holds SELECT * FROM disk_holds',
    'UPDATE reservations SET charged=0', "UPDATE reservations SET reservation_json=json_set(reservation_json,'$.resources.outputBytes',1)",
    'INSERT OR REPLACE INTO reservations SELECT * FROM reservations', 'DELETE FROM reservations',
    "UPDATE accepted_attempts SET intent_digest='wrong'", 'INSERT OR REPLACE INTO accepted_attempts SELECT * FROM accepted_attempts',
    'DELETE FROM accepted_attempts',
  ]) expect(() => f.db.exec(query), query).toThrow();
  expect(f.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(stats(f.db)).toMatchObject({ held_count: 1, held_output_bytes: 100, retained_output_bytes: 0 });
  const missing = native(); missing.db.exec('DROP TABLE disk_retention_stats');
  expect(() => diskRetention(missing.db)).toThrow('unavailable');
});
