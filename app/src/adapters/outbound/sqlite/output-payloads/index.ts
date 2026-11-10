export { boundedUniqueJson } from './json.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import type { DispatchKey } from '../../../../ports/dispatch.js';
import { HEADER_BYTES, MANIFEST_BYTES, RESULT_BYTES, payloadResult, requirePayload, splitSnapshot } from './values.js';
export { remainingEventAllowance } from './quota.js';
interface Header { snapshot_bytes: number | null; snapshot_json: string | null; result_observed: number }
function payload(db: DatabaseSync, key: DispatchKey) {
  const row = db.prepare(`SELECT kind,length(CAST(canonical_json AS BLOB)) bytes,
    CASE WHEN (kind='result' AND length(CAST(canonical_json AS BLOB))<=${RESULT_BYTES}) OR
      (kind='manifest' AND length(CAST(canonical_json AS BLOB))<=${MANIFEST_BYTES}) THEN canonical_json ELSE NULL END canonical_json
    FROM execution_output_payloads WHERE attempt_id=?`).get(key.attempt.attemptId);
  if (!row) return null;
  requirePayload(typeof row.bytes === 'number' && row.bytes > 0 && row.bytes <= (row.kind === 'result' ? RESULT_BYTES : MANIFEST_BYTES));
  return { kind: row.kind, result: payloadResult(row.kind, row.canonical_json) };
}
/** Stored presence is independent of a source arriving before a result observation. */
export function previousSnapshot(db: DatabaseSync, key: DispatchKey, row: Header): AttemptSnapshot | null {
  requirePayload(row.result_observed === 0 || row.result_observed === 1);
  if (row.snapshot_bytes === null) { requirePayload(row.result_observed === 0); return null; }
  requirePayload(row.snapshot_bytes <= HEADER_BYTES && typeof row.snapshot_json === 'string');
  const header = JSON.parse(row.snapshot_json) as AttemptSnapshot;
  requirePayload(!Object.hasOwn(header, 'result'));
  if (!row.result_observed) return header;
  const body = payload(db, key); requirePayload(body !== null);
  return { ...header, result: body.result };
}
/** Caller retains the immediate observation transaction through ACK and reply validation. */
export function persistSnapshot(db: DatabaseSync, key: DispatchKey, snapshot: AttemptSnapshot, charged: boolean): void {
  requirePayload(db.isTransaction);
  const split = splitSnapshot(snapshot);
  if (split.result !== null) {
    const body = payload(db, key);
    if (body) requirePayload(encodeCanonicalJson(body.result, RESULT_BYTES) === split.result);
    else db.prepare("INSERT INTO execution_output_payloads(attempt_id,kind,canonical_json) VALUES(?,'result',?)").run(key.attempt.attemptId, split.result);
  }
  db.prepare(`UPDATE execution_records SET snapshot_json=?,result_observed=?,acknowledged_generation=1,
    delivery_attempt_id=NULL,execution_charged=? WHERE attempt_id=?`)
    .run(split.header, Number(split.result !== null), Number(charged), key.attempt.attemptId);
}
