import type { DatabaseSync } from 'node:sqlite';
import { mergeAttemptObservation } from '../../../../domain/runs/index.js';
import type { AttemptIdentity } from '../../../../domain/runs/index.js';
import { HEADER_BYTES, RESULT_BYTES, requirePayload, splitSnapshot } from './values.js';

function visit(db: DatabaseSync, work: (row: Record<string, unknown>) => void): void {
  let after = 0;
  const query = db.prepare(`SELECT e.queue_order,e.attempt_id,e.organization_id,e.workspace_id,e.intent_digest,e.journal_authority,
    length(CAST(e.snapshot_json AS BLOB)) bytes,
    (SELECT count(*)=count(DISTINCT key) FROM json_each(e.snapshot_json)) unique_header_keys,
    CASE WHEN length(CAST(e.snapshot_json AS BLOB))<=73728 THEN e.snapshot_json ELSE NULL END snapshot_json,
    a.maximum_payload_bytes,coalesce(c.retained_bytes,0) retained_bytes
    FROM execution_records e JOIN attempt_output_allocations a ON a.attempt_id=e.attempt_id
    LEFT JOIN event_cursors c ON c.attempt_id=e.attempt_id WHERE e.queue_order>? ORDER BY e.queue_order LIMIT 1`);
  for (;;) {
    const row = query.get(after); if (!row) return;
    requirePayload(typeof row.queue_order === 'number' && row.queue_order > after); after = row.queue_order;
    work(row);
  }
}
function split(row: Record<string, unknown>) {
  requirePayload(typeof row.bytes === 'number' && row.bytes <= 73728 && typeof row.snapshot_json === 'string');
  const expected: AttemptIdentity = { attemptId: row.attempt_id as string, organizationId: row.organization_id as string,
    workspaceId: row.workspace_id as string, intentDigest: row.intent_digest as string, generation: 1 };
  return splitSnapshot(mergeAttemptObservation({ expected, previous: null, incoming: JSON.parse(row.snapshot_json) as unknown }).snapshot);
}
/** First pass changes no rows, columns or authority; failure leaves schema7 untouched. */
export function preflightPayloads(db: DatabaseSync): void {
  requirePayload(db.isTransaction);
  visit(db, row => {
    if (row.bytes === null) return;
    const value = split(row);
    requirePayload(Buffer.byteLength(value.header) <= HEADER_BYTES);
    if (value.result === null) { requirePayload(typeof row.bytes === 'number' && row.bytes <= HEADER_BYTES && row.unique_header_keys === 1); return; }
    requirePayload(row.journal_authority !== null);
    const size = Buffer.byteLength(value.result);
    requirePayload(size <= RESULT_BYTES && typeof row.maximum_payload_bytes === 'number' && Number.isSafeInteger(row.maximum_payload_bytes));
    requirePayload(typeof row.retained_bytes === 'number' && Number.isSafeInteger(row.retained_bytes) && row.retained_bytes >= 0);
    requirePayload(size <= row.maximum_payload_bytes && row.retained_bytes <= row.maximum_payload_bytes - size);
  });
}
/** Remove the old durable body before creating its carrier; the bounded local copy is memory only. */
export function convertPayloads(db: DatabaseSync): void {
  visit(db, row => {
    if (row.bytes === null) return;
    const value = split(row); if (value.result === null) return;
    db.prepare('UPDATE execution_records SET snapshot_json=? WHERE attempt_id=?').run(value.header, row.attempt_id as string);
    db.prepare("INSERT INTO execution_output_payloads(attempt_id,kind,canonical_json) VALUES(?,'result',?)")
      .run(row.attempt_id as string, value.result);
    db.prepare('UPDATE execution_records SET result_observed=1 WHERE attempt_id=?').run(row.attempt_id as string);
  });
}
