import { EVENT_MAX_RETAINED_BYTES } from '../../../../ports/events.js';
import type { DatabaseSync } from 'node:sqlite';
import type { EventBinding, EventCursorState } from '../../../../ports/events.js';
import { StorageError } from '../protocol.js';
import { remainingEventAllowance } from '../output-payloads/index.js';
import { captureState } from './values.js';
export function bindingArgs(binding: EventBinding): (string | number)[] {
  const { key, journalAuthority } = binding; const a = key.attempt;
  return [a.attemptId, key.runId, a.organizationId, a.workspaceId, a.intentDigest, journalAuthority, a.generation];
}
export function ownedAllowance(db: DatabaseSync, binding: EventBinding): number {
  const args = bindingArgs(binding);
  const owner = db.prepare(`SELECT a.maximum_payload_bytes FROM execution_records e
    JOIN attempt_output_allocations a ON a.attempt_id=e.attempt_id AND a.run_id=e.run_id
      AND a.organization_id=e.organization_id AND a.workspace_id=e.workspace_id
    WHERE e.attempt_id=? AND e.run_id=? AND e.organization_id=? AND e.workspace_id=? AND e.intent_digest=?
      AND e.journal_authority=? AND e.acknowledged_generation=? AND e.event_pending=1`).get(...args);
  if (!owner) throw new StorageError('not_found');
  if (typeof owner.maximum_payload_bytes !== 'number' || !Number.isSafeInteger(owner.maximum_payload_bytes)
    || owner.maximum_payload_bytes < 0) throw new StorageError('unavailable');
  return Math.min(remainingEventAllowance(db, binding.key.attempt.attemptId, owner.maximum_payload_bytes), EVENT_MAX_RETAINED_BYTES);
}
export function ensureCursor(db: DatabaseSync, binding: EventBinding): void {
  ownedAllowance(db, binding);
  const args = bindingArgs(binding);
  const row = db.prepare('SELECT attempt_id FROM event_cursors WHERE attempt_id=?').get(args[0]!);
  if (!row) db.prepare(`INSERT INTO event_cursors(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
    VALUES (?,?,?,?,?,?,?)`).run(...args);
}
export function readState(db: DatabaseSync, binding: EventBinding, allowAbsent = false): EventCursorState {
  const row = db.prepare(`SELECT durable_through,ack_confirmed_through,coverage,blocked_reason,retained_start_seq,retained_bytes,event_count,
    run_id,organization_id,workspace_id,intent_digest,journal_authority,generation FROM event_cursors WHERE attempt_id=?`)
    .get(binding.key.attempt.attemptId);
  if (!row) {
    if (!allowAbsent) throw new StorageError('unavailable');
    return captureState({ binding, durableThrough: 0, ackConfirmedThrough: 0, coverage: 'contiguous', blockedReason: null,
      retainedStartSeq: null, retainedBytes: 0, eventCount: 0 }, binding);
  }
  try { return captureState({ binding: { key: { runId: row.run_id, attempt: { attemptId: binding.key.attempt.attemptId,
    organizationId: row.organization_id, workspaceId: row.workspace_id, intentDigest: row.intent_digest, generation: row.generation } },
    journalAuthority: row.journal_authority }, durableThrough: row.durable_through, ackConfirmedThrough: row.ack_confirmed_through,
    coverage: row.coverage, blockedReason: row.blocked_reason, retainedStartSeq: row.retained_start_seq,
    retainedBytes: row.retained_bytes, eventCount: row.event_count }, binding); }
  catch { throw new StorageError('unavailable'); }
}

/** Finalized ACK recovery is a point read, independent of pending discovery. */
export function finalizedState(db: DatabaseSync, binding: EventBinding): EventCursorState | null {
  const where = 'WHERE attempt_id=? AND run_id=? AND organization_id=? AND workspace_id=? AND intent_digest=? AND journal_authority=? AND generation=?';
  const row = db.prepare(`SELECT final_agent_seq FROM execution_output_finalizations ${where}
    UNION ALL SELECT final_agent_seq FROM execution_output_absence_finalizations ${where}`).get(...bindingArgs(binding), ...bindingArgs(binding));
  if (!row) return null;
  const state = readState(db, binding);
  if (state.durableThrough !== row.final_agent_seq || state.ackConfirmedThrough !== row.final_agent_seq
    || state.blockedReason !== null || state.coverage !== 'contiguous') throw new StorageError('unavailable');
  return state;
}
