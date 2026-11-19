import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import { captureStoredStoppedObservation } from '@beetle/contracts/output-source';
import type { StoppedObservation } from '@beetle/contracts/output-source';
import type { OutputFinalizationRequest } from '../../../../ports/output-finalization.js';
import type { EventBinding } from '../../../../ports/events.js';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';

type Permit = StoppedObservation & { attemptId: string; sourceDigest: string };
const originals = new WeakMap<DatabaseSync, Permit>();

export function registerSourceStoppedHistory(db: DatabaseSync): void {
  db.function('backend_source_stopped_history_insert', (attempt, source, json, digest, bytes) => {
    const permit = originals.get(db);
    return permit &&
      permit.attemptId === attempt &&
      permit.sourceDigest === source &&
      permit.json === json &&
      permit.digest === digest &&
      permit.bytes === bytes
      ? 1
      : 0;
  });
}

/** Insert before the sole finalization receipt within the same SQLite transaction. */
export function retainSourceStoppedHistory(
  db: DatabaseSync,
  request: OutputFinalizationRequest,
  row: Record<string, SQLOutputValue>,
): 'fetch' | 'done' {
  const history = request.stoppedHistory;
  if (history === undefined) return 'done';
  if (history === 'fetch') return eligible(row) && remainingBytes(row) > 0 ? 'fetch' : 'done';
  if (!eligible(row) || row.final_agent_seq !== history.finalAgentSeq) throw new StorageError('invalid_input');
  const observation = history.observation;
  if (observation === null) return 'done';
  if (observation.bytes <= remainingBytes(row)) insert(db, request, observation);
  return 'done';
}

function eligible(row: Record<string, SQLOutputValue>): boolean {
  return row.history_ready === 1 && (row.state === 'errored' || row.state === 'cancelled');
}

function remainingBytes(row: Record<string, SQLOutputValue>): number {
  if (typeof row.retained_payload_bytes !== 'number' || typeof row.maximum_payload_bytes !== 'number')
    throw new StorageError('unavailable');
  return row.maximum_payload_bytes - row.retained_payload_bytes;
}

function insert(db: DatabaseSync, request: OutputFinalizationRequest, observation: StoppedObservation): void {
  if (!db.isTransaction || originals.has(db)) throw new StorageError('unavailable');
  const { sourceDigest } = request;
  const { attemptId } = request.binding.key.attempt;
  originals.set(db, { ...observation, attemptId, sourceDigest });
  try {
    db.prepare(
      'INSERT INTO execution_source_stopped_history(attempt_id,source_digest,canonical_json,digest,bytes) VALUES(?,?,?,?,?)',
    ).run(attemptId, sourceDigest, observation.json, observation.digest, observation.bytes);
  } finally {
    originals.delete(db);
  }
}

export function readSourceStoppedHistory(
  db: DatabaseSync,
  binding: EventBinding,
  sourceDigest: string,
): StoppedObservation | null {
  const attempt = binding.key.attempt;
  const row = db
    .prepare(
      `SELECT source_digest,digest,bytes,
    CASE WHEN length(CAST(canonical_json AS BLOB))<=? THEN canonical_json END json
    FROM execution_source_stopped_history WHERE attempt_id=?`,
    )
    .get(LIVE_HISTORY_BYTES, attempt.attemptId);
  if (!row) return null;
  if (row.source_digest !== sourceDigest) throw new StorageError('unavailable');
  try {
    return captureStoredStoppedObservation(
      { json: row.json, bytes: row.bytes, digest: row.digest },
      { ...attempt, journalAuthority: binding.journalAuthority },
      sha256,
    );
  } catch {
    throw new StorageError('unavailable');
  }
}

export function sourceStoppedHistoryCharge(db: DatabaseSync, binding: EventBinding, sourceDigest: string): number {
  const row = db
    .prepare(
      `SELECT source_digest,bytes,length(CAST(canonical_json AS BLOB)) actual
    FROM execution_source_stopped_history WHERE attempt_id=?`,
    )
    .get(binding.key.attempt.attemptId);
  if (!row) return 0;
  if (
    row.source_digest !== sourceDigest ||
    typeof row.bytes !== 'number' ||
    row.bytes < 1 ||
    row.bytes > LIVE_HISTORY_BYTES ||
    row.bytes !== row.actual
  )
    throw new StorageError('unavailable');
  return row.bytes;
}
