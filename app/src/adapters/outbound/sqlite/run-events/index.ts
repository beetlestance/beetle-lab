import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { captureRunEventCursor, encodeRunEventCursor } from '@beetle/contracts/api';
import type { Run, RunEventPage } from '@beetle/contracts/api';
import type { RunEventsQuery } from '../../../../ports/run-events.js';
import type { RunKey } from '../../../../ports/runs.js';
import { transaction } from '../transaction.js';
import { StorageError } from '../protocol.js';
import { captureRunEventsOperation, captureRunEventsReply } from './wire.js';
export { runEventsOperation, captureRunEventsOperation, captureRunEventsReply } from './wire.js';

interface RunLookup { get(key: RunKey): Run }
type Row = Record<string, SQLOutputValue>;
const PAYLOAD_BUDGET = 262144 - 4096;
function unavailable(condition: boolean): void { if (!condition) throw new StorageError('unavailable'); }

/** One synchronous snapshot. Scope resolves before cursors. PK ranges admit keys
 * and cumulative charges before any <=100 bodies are materialized. GET has no
 * ACK, accounting, lifecycle or cursor-row effects. Missing/corrupt storage fails.
 */
export class RunEvents {
  constructor(private readonly db: DatabaseSync, private readonly runs: RunLookup) {}
  get(input: RunEventsQuery): RunEventPage {
    let query: RunEventsQuery;
    try { query = captureRunEventsOperation({ kind: 'getRunEvents', query: input }).query; }
    catch { throw new StorageError('invalid_input'); }
    return transaction(this.db, () => {
      const run = this.runs.get(query);
      const cursor = this.cursor(run);
      const durable = cursor === undefined ? 0 : cursor.durable_through;
      unavailable(typeof durable === 'number' && Number.isSafeInteger(durable) && durable >= 0 && durable <= 65536);
      const after = this.after(query, run, durable as number);
      try {
        const items = this.items(run, after, durable as number, query.limit);
        return captureRunEventsReply(query, this.page(run, cursor, after, items));
      } catch { throw new StorageError('unavailable'); }
    });
  }
  private page(run: Run, cursor: Row | undefined, after: number, items: unknown[]): unknown {
    const durable = cursor === undefined ? 0 : cursor.durable_through;
    const resumeCursor = encodeRunEventCursor({ organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId,
      runId: run.id, attemptId: run.activeAttemptId, generation: 1, afterSeq: after + items.length });
    return { id: run.id, scope: run.scope, activeAttemptId: run.activeAttemptId, generation: 1,
      afterSeq: after, durableThrough: durable, coverage: cursor === undefined ? 'pending' : cursor.coverage,
      blockedReason: cursor?.blocked_reason ?? null, retainedStartSeq: cursor?.retained_start_seq ?? null,
      items, resumeCursor, nextCursor: after + items.length < (durable as number) ? resumeCursor : null };
  }
  private cursor(run: Run): Row | undefined {
    const owner = this.db.prepare(`SELECT t.generation,t.intent_digest,e.run_id,e.organization_id,e.workspace_id,
      e.intent_digest retained_digest,e.acknowledged_generation,e.journal_authority
      FROM attempts t LEFT JOIN execution_records e ON e.attempt_id=t.id
      WHERE t.id=? AND t.run_id=? AND t.organization_id=? AND t.workspace_id=?`)
      .get(run.activeAttemptId, run.id, run.scope.organizationId, run.scope.workspaceId);
    unavailable(!!owner);
    validateOwner(owner!, run);
    const row = this.db.prepare(`SELECT run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,
      durable_through,coverage,blocked_reason,retained_start_seq FROM event_cursors WHERE attempt_id=?`).get(run.activeAttemptId);
    if (row) unavailable(row.run_id === run.id && row.organization_id === run.scope.organizationId
      && row.workspace_id === run.scope.workspaceId && row.generation === 1 && owner!.generation === 1
      && row.intent_digest === owner!.intent_digest && row.journal_authority === owner!.journal_authority);
    return row;
  }
  private after(query: RunEventsQuery, run: Run, durable: number): number {
    if (query.cursor === undefined) return 0;
    try {
      const p = captureRunEventCursor(query.cursor);
      if (p.organizationId !== run.scope.organizationId || p.workspaceId !== run.scope.workspaceId || p.runId !== run.id
        || p.attemptId !== run.activeAttemptId || p.generation !== 1 || p.afterSeq > durable) throw new Error('cursor');
      return p.afterSeq;
    } catch { throw new StorageError('invalid_input'); }
  }
  private priorCharge(run: Run, after: number): number {
    const base = after === 0 ? 0 : this.db.prepare(`SELECT cumulative_bytes FROM run_events
      WHERE attempt_id=? AND generation=1 AND seq=?`).get(run.activeAttemptId, after)?.cumulative_bytes;
    unavailable(typeof base === 'number' && Number.isSafeInteger(base) && base >= 0 && base <= 67108864);
    return base as number;
  }
  private items(run: Run, after: number, durable: number, limit: number): unknown[] {
    const base = this.priorCharge(run, after);
    const keys = this.db.prepare(`SELECT seq,charged_bytes,cumulative_bytes FROM run_events
      WHERE attempt_id=? AND generation=1 AND seq>? AND seq<=? ORDER BY seq LIMIT ?`)
      .all(run.activeAttemptId, after, durable, limit);
    const items: unknown[] = []; let previous = base as number;
    const body = this.db.prepare(`SELECT CASE WHEN length(CAST(canonical_json AS BLOB))<=65536 THEN canonical_json ELSE NULL END canonical_json
      FROM run_events WHERE attempt_id=? AND generation=1 AND seq=?`);
    for (const [index, row] of keys.entries()) {
      validateCharge(row, after + index + 1, previous);
      if ((row.cumulative_bytes as number) - (base as number) > PAYLOAD_BUDGET) break;
      const value = body.get(run.activeAttemptId, row.seq!)?.canonical_json;
      unavailable(typeof value === 'string' && Buffer.byteLength(value) + 128 === row.charged_bytes);
      items.push(JSON.parse(value as string) as unknown); previous = row.cumulative_bytes as number;
    }
    unavailable(items.length > 0 || after === durable);
    unavailable(keys.length === Math.min(limit, durable - after));
    return items;
  }
}

function validateOwner(owner: Row, run: Run): void {
  if (owner.run_id === null) { unavailable(owner.generation === null); return; }
  unavailable(owner.run_id === run.id && owner.organization_id === run.scope.organizationId
    && owner.workspace_id === run.scope.workspaceId && owner.intent_digest === owner.retained_digest
    && owner.generation === owner.acknowledged_generation);
}
function validateCharge(row: Row, seq: number, previous: number): void {
  unavailable(row.seq === seq && typeof row.charged_bytes === 'number' && row.charged_bytes >= 128
    && row.charged_bytes <= 65664 && typeof row.cumulative_bytes === 'number'
    && Number.isSafeInteger(row.cumulative_bytes) && row.cumulative_bytes <= 67108864
    && row.cumulative_bytes === previous + row.charged_bytes);
}
