import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pendingFactsSql, chargedFactsSql } from '../../src/adapters/outbound/sqlite/dispatch-candidates.js';
import { claimsFixture } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';

let f: ClaimsFixture;
// Fund retained enqueue controls; explicit storage-bound cases set their own exact ceilings.
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(4_000_000); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });
it('captures a finite pass, exact per-item continuation, and excludes later appends', () => {
  const keys = [f.add(), f.add(71), f.add(72)];
  const first = f.claims.scan({ lane: 'queued', limit: 2 });
  expect(first.items.map(item => item.key)).toEqual(keys.slice(0, 2));
  f.add(73);
  const tail = f.claims.scan({ lane: 'queued', limit: 32, cursor: first.nextCursor! });
  expect(tail.items.map(item => item.key)).toEqual(keys.slice(2));
  expect(tail.nextCursor).toBeNull();
  const afterFirst = f.claims.scan({ lane: 'queued', limit: 32, cursor: first.items[0]!.after });
  expect(afterFirst.items.map(item => item.key)).toEqual(keys.slice(1));
  expect(f.claims.scan({ lane: 'queued', limit: 32, cursor: tail.items[0]!.after }).items).toEqual([]);
  expect(f.claims.scan({ lane: 'queued', limit: 32 }).items).toHaveLength(4);
});
it('binds cursors to installation/lane and validates bounded closed query without getters', () => {
  f.add(); f.add(71);
  const cursor = f.claims.scan({ lane: 'queued', limit: 1 }).nextCursor!;
  expect(() => f.claims.scan({ lane: 'reconcile', limit: 1, cursor })).toThrow();
  const tuple = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown[];
  tuple[1] = '00000000-0000-4000-8000-000000000099';
  expect(() => f.claims.scan({ lane: 'queued', limit: 1, cursor: Buffer.from(JSON.stringify(tuple)).toString('base64url') })).toThrow();
  for (const cursor of ['x'.repeat(1025), '%', Buffer.from('[1]').toString('base64url')])
    expect(() => f.claims.scan({ lane: 'queued', limit: 1, cursor })).toThrow();
  for (const limit of [0, 33, 1.5, NaN]) expect(() => f.claims.scan({ lane: 'queued', limit })).toThrow();
  const getter = vi.fn();
  expect(() => f.claims.scan({ get lane() { getter(); return 'queued' as const; }, limit: 1 })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => f.claims.scan({ lane: 'queued', limit: 1, extra: true } as never)).toThrow();
});
it('bounds all discovery replies and marks advisory occupancy without loading payload columns', () => {
  for (let n = 0; n < 35; n++) f.add(1000 + n * 2);
  const first = f.claims.scan({ lane: 'queued', limit: 32 });
  expect(first.items).toHaveLength(32);
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(65536);
  expect(first.items.every(item => item.eligibility.kind === 'ready')).toBe(true);
  f.claims.claim(first.items[0]!.key); f.claims.claim(first.items[1]!.key);
  expect(f.claims.scan({ lane: 'queued', limit: 32 }).items[2]!.eligibility).toEqual({ kind: 'blocked', reason: 'budget_unavailable' });
  expect(pendingFactsSql).not.toMatch(/offer_json|registry_json/);
  const plans = [pendingFactsSql, chargedFactsSql].map(sql => f.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => String(row.detail)).join('\n'));
  expect(plans[0]).toMatch(/SCAN d USING INDEX outbox_due/);
  expect(plans[1]).toMatch(/SCAN c USING INDEX execution_charged/);
  expect(plans[0]).not.toMatch(/SCAN (a|i|r)\b/);
});
it('refuses a 4097th compact pending row before interpreting the selected queue', () => {
  f.db.exec('DROP TRIGGER execution_intent_insert');
  // Synthetic diagnostic legacy rows bypass only enqueue guards, preserving FK/byte checks.
  f.db.exec('DROP TRIGGER attempts_foundation_insert; DROP TRIGGER outbox_requires_summary; DROP TRIGGER outbox_owned_summary;');
  const key = f.add();
  const source = f.db.prepare('SELECT * FROM attempts WHERE id=?').get(key.attempt.attemptId)!;
  const insert = f.db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,
    offer_json,registry_json,state) VALUES(?,?,?,?,?,?,?,?, 'offered')`);
  const outbox = f.db.prepare('INSERT INTO dispatch_outbox(attempt_id,intent_digest) VALUES(?,?)');
  f.db.exec('BEGIN IMMEDIATE');
  for (let n = 1; n <= 4096; n++) {
    const id = `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
    const offer = JSON.parse(String(source.offer_json)) as { attemptId: string }; offer.attemptId = id;
    insert.run(id, key.runId, source.organization_id!, source.workspace_id!, n + 1, source.intent_digest!, JSON.stringify(offer), source.registry_json!);
    outbox.run(id, source.intent_digest!);
  }
  f.db.exec('COMMIT');
  expect(() => f.claims.scan({ lane: 'queued', limit: 1 })).toThrow('Storage queue_full');
  expect(() => f.claims.claim(key)).toThrow('Storage queue_full');
});
it('drives a short pending page from the outbox index despite large historical attempt payloads', () => {
  const key = f.add();
  const source = f.db.prepare('SELECT * FROM attempts WHERE id=?').get(key.attempt.attemptId)!;
  const insert = f.db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,
    offer_json,registry_json,state,foundation_owned) VALUES(?,?,?,?,?,?,?,?, 'offered',1)`);
  f.db.exec('BEGIN IMMEDIATE');
  for (let n = 1; n <= 2000; n++) {
    const id = `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
    const offer = JSON.parse(String(source.offer_json)) as { attemptId: string }; offer.attemptId = id;
    insert.run(id, key.runId, source.organization_id!, source.workspace_id!, n + 1, source.intent_digest!, JSON.stringify(offer), source.registry_json!);
  }
  f.db.exec('COMMIT');
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN ${pendingFactsSql}`).all().map(row => String(row.detail));
  expect(plan[0]).toMatch(/SCAN d USING INDEX outbox_due/);
  expect(plan.join('\n')).not.toMatch(/SCAN (a|i|r)\b/);
  expect(f.claims.scan({ lane: 'queued', limit: 32 }).items.map(item => item.key)).toEqual([key]);
});
