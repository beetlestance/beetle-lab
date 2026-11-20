import type { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { requestId, uuid } from '../storage/fixture.js';
import {
  nextWorkspace,
  nextWorkspaceSql,
  retiredRuns,
  retiredRunsSql,
} from '../../src/adapters/outbound/sqlite/retired-reclaim/candidates.js';
import { reclaimCursor } from '../../src/adapters/outbound/sqlite/retired-reclaim/cursor.js';
import { count, pass, reclaim, retireOrganization, retireWorkspace, usage } from './fixture.js';
const other = { kind: 'workspace' as const, organizationId: uuid(21), workspaceId: uuid(22) };
/** Simulates historical rows the current triggers would refuse, then restores every trigger. */
function legacy(db: DatabaseSync, table: string, edit: () => void): void {
  const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table);
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${String(trigger.name)}"`);
  try {
    edit();
  } finally {
    for (const trigger of triggers) db.exec(String(trigger.sql));
  }
}
function cancelled(f: ReturnType<typeof claimsFixture>, ids: number[]): string[] {
  return ids.map((id) => {
    const key = f.add(id);
    f.store.execute({ kind: 'cancelRun', command: cancelCommand(key.runId) });
    return key.runId;
  });
}
it('begins only retired Runs, transitively through a retired organisation, and leaves a live workspace untouched', () => {
  const f = claimsFixture();
  try {
    const [live] = cancelled(f, [70]);
    const retired = f.addOther();
    f.store.execute({
      kind: 'cancelRun',
      command: cancelCommand(retired.runId, { scope: other, requestId: requestId() }),
    });
    expect(pass(f.store).begun).toEqual([]);
    retireWorkspace(f.store, other.organizationId, other.workspaceId);
    retireOrganization(f.store, other.organizationId);
    const liveRows = JSON.stringify(f.db.prepare('SELECT * FROM runs WHERE id=?').all(live!));
    const charged = usage(f.db);
    expect(pass(f.store).begun).toEqual([retired.runId]);
    expect(usage(f.db)).toBe(charged);
    expect(count(f.db, 'SELECT count(*) n FROM output_deletion_intents WHERE run_id=?', live!)).toBe(0);
    expect(JSON.stringify(f.db.prepare('SELECT * FROM runs WHERE id=?').all(live!))).toBe(liveRows);
    const intent = f.db.prepare('SELECT id FROM output_deletion_intents WHERE run_id=?').get(retired.runId)!;
    const key = { scope: other, id: String(intent.id), runId: retired.runId };
    const result = f.store.execute({
      kind: 'settleBackendOutput',
      request: { key, agentReply: null },
    }) as BackendSettlementResult;
    expect(result.kind).toBe('unsent');
    expect(usage(f.db)).toBe(charged - result.refundedBytes);
    expect(count(f.db, 'SELECT count(*) n FROM backend_retired_runs WHERE run_id=?', retired.runId)).toBe(1);
    expect(count(f.db, 'SELECT count(*) n FROM namespace_deletions')).toBe(2);
    expect(count(f.db, 'SELECT count(*) n FROM organizations WHERE id=? AND retired=1', other.organizationId)).toBe(1);
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.db.close();
  }
});
it('keeps every page bounded, replays idempotently and never offers pinned or noted Runs', () => {
  const f = claimsFixture();
  try {
    const runs = cancelled(f, [70, 71, 73, 74, 75, 76]);
    const pinned = runs[0]!;
    const noted = runs[1]!;
    f.db
      .prepare('INSERT INTO run_pins SELECT id,organization_id,workspace_id,?,? FROM runs WHERE id=?')
      .run('2026-11-12T00:00:00.000Z', requestId(), pinned);
    f.db
      .prepare(
        "INSERT INTO run_notes(run_id,organization_id,workspace_id,version,note) SELECT id,organization_id,workspace_id,1,'Kept' FROM runs WHERE id=?",
      )
      .run(noted);
    retireWorkspace(f.store, uuid(1), uuid(2));
    const first = pass(f.store, 2);
    expect(first.pages.length).toBeGreaterThan(2);
    expect(first.pages.every((page) => page.items.length <= 2)).toBe(true);
    expect(new Set(first.begun)).toEqual(new Set(runs.slice(2)));
    const intents = f.db.prepare('SELECT * FROM output_deletion_intents ORDER BY id').all();
    expect(pass(f.store, 2).begun).toEqual([]);
    expect(pass(f.store, 32).begun).toEqual([]);
    expect(f.db.prepare('SELECT * FROM output_deletion_intents ORDER BY id').all()).toEqual(intents);
    expect(count(f.db, 'SELECT count(*) n FROM output_deletion_intents WHERE run_id IN (?,?)', pinned, noted)).toBe(0);
  } finally {
    f.db.close();
  }
});
it('replays a lost reply with the same deterministic identity and rejects malformed cursors', () => {
  const f = claimsFixture();
  try {
    const [run] = cancelled(f, [70]);
    retireWorkspace(f.store, uuid(1), uuid(2));
    const page = reclaim(f.store);
    const replay = claimsFixture();
    try {
      const [again] = cancelled(replay, [70]);
      expect(again).toBe(run);
      retireWorkspace(replay.store, uuid(1), uuid(2));
      expect(reclaim(replay.store).items.map((item) => item.id)).toEqual(page.items.map((item) => item.id));
    } finally {
      replay.db.close();
    }
    for (const cursor of ['', 'not-a-cursor', Buffer.from('["retired-reclaim-v1",0,"x","y",""]').toString('base64url')])
      expect(() => reclaim(f.store, { cursor })).toThrow();
    expect(() => reclaim(f.store, { limit: 33 })).toThrow();
    expect(() => reclaim(f.store, { requestedAt: 'yesterday' })).toThrow();
  } finally {
    f.db.close();
  }
});
it('uses only indexed probes for workspace, Run and eligibility reads', () => {
  const f = claimsFixture();
  try {
    const at = { organizationId: uuid(1), workspaceId: uuid(2), runId: '', inside: true };
    expect(nextWorkspace(f.db, { ...at, workspaceId: '', inside: false })).toMatchObject({
      workspaceId: uuid(2),
      retired: false,
    });
    expect(retiredRuns(f.db, at, 2)).toEqual([]);
    const plans = [nextWorkspaceSql, retiredRunsSql].map((sql) =>
      f.db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => String(row.detail)),
    );
    // The only scan allowed is the two-row LIMIT subquery that counts attempts.
    for (const detail of plans.flat()) expect(detail).not.toMatch(/^SCAN (?!\(subquery-\d+\))|USE TEMP B-TREE/);
  } finally {
    f.db.close();
  }
});
it('never offers multi-attempt Runs or legacy Runs without a funded cleanup control', () => {
  const f = claimsFixture();
  try {
    const [unfunded, retried, plain] = cancelled(f, [70, 71, 73]);
    legacy(f.db, 'backend_cleanup_controls', () =>
      f.db.prepare('DELETE FROM backend_cleanup_controls WHERE run_id=?').run(unfunded!),
    );
    const second = uuid(9099);
    legacy(f.db, 'attempts', () =>
      f.db
        .prepare(
          `INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,offer_json,registry_json,generation,state)
       SELECT ?,run_id,organization_id,workspace_id,2,intent_digest,json_set(offer_json,'$.attemptId',?),registry_json,NULL,'lost'
       FROM attempts WHERE run_id=?`,
        )
        .run(second, second, retried!),
    );
    retireWorkspace(f.store, uuid(1), uuid(2));
    expect(pass(f.store).begun).toEqual([plain]);
    expect(pass(f.store).begun).toEqual([]);
  } finally {
    f.db.close();
  }
});
it('re-checks retirement on resume, so a cursor claiming a live workspace begins nothing', () => {
  const f = claimsFixture();
  try {
    const [live] = cancelled(f, [70]);
    const cursor = reclaimCursor({ organizationId: uuid(1), workspaceId: uuid(2), runId: '', inside: true });
    expect(reclaim(f.store, { cursor }).items).toEqual([]);
    expect(count(f.db, 'SELECT count(*) n FROM output_deletion_intents WHERE run_id=?', live!)).toBe(0);
  } finally {
    f.db.close();
  }
});
