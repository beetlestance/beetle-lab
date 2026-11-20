import { expect, it } from 'vitest';
import { captureSettlementRequest, settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
import type { OutputCleanupAck, OutputDeletionFile } from '../../src/ports/output-deletion-metadata.js';
import { ready, plan, scope } from '../output-deletion/fixture.js';
import { cleaned, hash } from '../output-deletion/cleanup-ack/fixture.js';
import { count, reclaim, requestedAt, retireWorkspace, usage } from './fixture.js';
it('reclaims a retired source-backed Run through file removal, ACK and settlement; refunds only at settlement', () => {
  // The payload fixture closes its own handle after each test.
  const f = ready(2);
  retireWorkspace(f.store, scope.organizationId, scope.workspaceId);
  const receipts = f.db.prepare('SELECT * FROM receipts ORDER BY rowid').all();
  const marker = f.db.prepare('SELECT * FROM namespace_deletions').all();
  const charged = usage(f.db);
  const page = reclaim(f.store);
  expect(page).toMatchObject({ nextCursor: null, items: [{ runId: f.key.runId, kind: 'source', requestedAt }] });
  expect(usage(f.db)).toBe(charged);
  expect(f.db.prepare('SELECT * FROM receipts ORDER BY rowid').all()).toEqual(receipts);
  const key = { scope, id: page.items[0]!.id, runId: f.key.runId };
  for (const ordinal of [0, 1]) {
    const value = f.store.execute({ kind: 'getOutputDeletionFile', key: { ...key, ordinal } }) as OutputDeletionFile;
    const native = plan(value);
    const owned = { key: { ...key, ordinal } };
    f.store.execute({ kind: 'recordOutputDeletionPlan', request: { ...owned, expectedVersion: 1, plan: native } });
    f.store.execute({
      kind: 'recordOutputDeletionAbsence',
      request: { ...owned, expectedVersion: 2, receipt: { ...native, phase: 'absent' } },
    });
  }
  expect(usage(f.db)).toBe(charged);
  const request = f.store.execute({ kind: 'getOutputRetirementRequest', key }) as RetirementRequest;
  const ack = f.store.execute({
    kind: 'recordOutputCleanupAck',
    request: { key, reply: cleaned(request) },
  }) as OutputCleanupAck;
  if (!('replyDigest' in ack)) throw Error('Missing ACK');
  expect(usage(f.db)).toBe(charged);
  const release = captureSettlementRequest({ version: 1, retirement: request, cleanupReplyDigest: ack.replyDigest });
  const agentReply = {
    version: 1 as const,
    state: 'settled' as const,
    requestDigest: settlementRequestDigest(release, hash),
    cleanupReplyDigest: release.cleanupReplyDigest,
    tombstoneDigest: 'd'.repeat(64),
    chargedBytes: 4096 as const,
  };
  const result = f.store.execute({
    kind: 'settleBackendOutput',
    request: { key, agentReply },
  }) as BackendSettlementResult;
  expect(result.kind).toBe('source');
  expect(result.refundedBytes).toBeGreaterThan(0);
  expect(usage(f.db)).toBe(charged - result.refundedBytes);
  expect(count(f.db, 'SELECT count(*) n FROM runs WHERE id=?', f.key.runId)).toBe(0);
  expect(count(f.db, 'SELECT count(*) n FROM backend_retired_runs WHERE run_id=?', f.key.runId)).toBe(1);
  expect(f.db.prepare('SELECT * FROM namespace_deletions').all()).toEqual(marker);
  expect(f.db.prepare('SELECT * FROM receipts ORDER BY rowid').all()).toEqual(receipts);
  expect(count(f.db, 'SELECT count(*) n FROM workspaces WHERE id=? AND retired=1', scope.workspaceId)).toBe(1);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(reclaim(f.store)).toEqual({ items: [], nextCursor: null });
});
