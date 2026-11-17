import { HEADER_BYTES } from './output-payloads/index.js';
import { checkedJournalAuthority } from './input-values.js';
import { StorageError } from './protocol.js';
import { storedRecord, storedInteger, storedFlag, storedUuid, storedTimestamp } from './stored-values.js';
import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
export interface RecordRow {
  journal_authority: string | null;
  snapshot_bytes: number | null;
  snapshot_json: string | null;
  result_observed: 0 | 1;
  execution_charged: 0 | 1;
  acknowledged_generation: 1 | null;
  delivery_attempt_id: string | null;
  generation: 1 | null;
}
export interface DeliveryRow {
  intent_digest: string;
  execution_intent_id: string | null;
  possible_delivery: 0 | 1;
  first_delivery_at: string | null;
}
export const observationColumns = [
  "CASE WHEN e.snapshot_json IS NULL THEN NULL WHEN typeof(e.snapshot_json)='text' THEN length(CAST(e.snapshot_json AS BLOB)) ELSE -1 END AS snapshot_bytes",
  sqlTextColumn('snapshot_json', HEADER_BYTES, true, 'e.'),
  sqlTextColumn('journal_authority', 36, true, 'e.'),
  sqlIntegerColumn('result_observed', false, 'e.'),
  sqlIntegerColumn('execution_charged', false, 'e.'),
  sqlIntegerColumn('acknowledged_generation', true, 'e.'),
  sqlTextColumn('delivery_attempt_id', 45, true, 'e.'),
  sqlIntegerColumn('generation', true, 'a.'),
].join(',');
export const deliveryColumns = [
  sqlTextColumn('intent_digest', 64),
  sqlTextColumn('execution_intent_id', 45, true),
  sqlIntegerColumn('possible_delivery'),
  sqlTextColumn('first_delivery_at', 40, true),
].join(',');
function generation(input: unknown): 1 | null {
  if (input === null) return null;
  if (input !== 1) throw new StorageError('unavailable');
  return input;
}
function authority(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string') throw new StorageError('unavailable');
  try {
    checkedJournalAuthority(input);
    return input;
  } catch {
    throw new StorageError('unavailable');
  }
}
function snapshot(input: unknown, bytes: number | null): string | null {
  if (input === null) {
    if (bytes !== null) throw new StorageError('unavailable');
    return null;
  }
  if (typeof input !== 'string' || bytes === null || Buffer.byteLength(input) !== bytes)
    throw new StorageError('unavailable');
  return input;
}
export function captureObservationRow(input: unknown): RecordRow {
  const row = storedRecord(input);
  const bytes = row.snapshot_bytes === null ? null : storedInteger(row.snapshot_bytes, 0, HEADER_BYTES);
  return {
    journal_authority: authority(row.journal_authority),
    snapshot_bytes: bytes,
    snapshot_json: snapshot(row.snapshot_json, bytes),
    result_observed: storedFlag(row.result_observed),
    execution_charged: storedFlag(row.execution_charged),
    acknowledged_generation: generation(row.acknowledged_generation),
    delivery_attempt_id: row.delivery_attempt_id === null ? null : storedUuid(row.delivery_attempt_id),
    generation: generation(row.generation),
  };
}
export function captureDeliveryRow(input: unknown): DeliveryRow | undefined {
  if (input === undefined) return undefined;
  const row = storedRecord(input);
  if (typeof row.intent_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.intent_digest))
    throw new StorageError('unavailable');
  return {
    intent_digest: row.intent_digest,
    execution_intent_id: row.execution_intent_id === null ? null : storedUuid(row.execution_intent_id),
    possible_delivery: storedFlag(row.possible_delivery),
    first_delivery_at: row.first_delivery_at === null ? null : storedTimestamp(row.first_delivery_at),
  };
}
