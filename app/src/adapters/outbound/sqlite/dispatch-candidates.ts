import type { DatabaseSync } from 'node:sqlite';
import type { DispatchKey } from '../../../ports/dispatch.js';
import { MAX_DISPATCH_CHARGED, MAX_DISPATCH_PENDING } from '../../../ports/dispatch.js';
import { captureDispatchKey } from './dispatch-values.js';
import { StorageError } from './protocol.js';

export interface DispatchFact {
  attempt_id: string; run_id: string; organization_id: string; workspace_id: string; intent_digest: string;
  queue_order: number | null; profile_alias: string; registry_digest: string;
  cpu_millis: number; memory_bytes: number; pids: number; timeout_ms: number; output_bytes: number;
  staging_bytes: number; mode: 'parallel' | 'isolated';
  state: string; current_attempt: number; cancellation_requested: number; version: number; generation: number | null;
  foundation_owned: number; attempt_marker: string | null; outbox_marker: string | null;
  possible_delivery: number | null; first_delivery_at: string | null;
  record_id: string | null; execution_charged: number | null; acknowledged_generation: number | null;
  delivery_attempt_id: string | null; snapshot_present: number; output_id: string | null;
  maximum_payload_bytes: number | null; metadata_bytes: number | null; charged_bytes: number | null;
}
const columns = `a.id attempt_id,a.run_id,a.organization_id,a.workspace_id,a.intent_digest,
 i.queue_order,i.profile_alias,i.registry_digest,i.cpu_millis,i.memory_bytes,i.pids,i.timeout_ms,
 i.output_bytes,i.staging_bytes,i.mode,r.state,(r.active_attempt_id=a.id) current_attempt,r.cancellation_requested,r.version,a.generation,a.foundation_owned,
 a.execution_intent_id attempt_marker,d.execution_intent_id outbox_marker,d.possible_delivery,d.first_delivery_at,
 e.attempt_id record_id,e.execution_charged,e.acknowledged_generation,e.delivery_attempt_id,
 (e.snapshot_json IS NOT NULL) snapshot_present,o.attempt_id output_id,o.maximum_payload_bytes,o.metadata_bytes,o.charged_bytes`;
const joins = `JOIN runs r ON r.id=a.run_id AND r.organization_id=a.organization_id AND r.workspace_id=a.workspace_id
 LEFT JOIN execution_intents i ON i.attempt_id=a.id
 LEFT JOIN execution_records e ON e.attempt_id=a.id LEFT JOIN attempt_output_allocations o ON o.attempt_id=a.id`;
/** Pending-index driven; LIMIT is applied before any interpretation or policy work. */
export const pendingFactsSql = `SELECT ${columns} FROM dispatch_outbox d INDEXED BY outbox_due
 CROSS JOIN attempts a ON a.id=d.attempt_id ${joins} LIMIT ${MAX_DISPATCH_PENDING + 1}`;
export const chargedFactsSql = `SELECT ${columns} FROM execution_records c INDEXED BY execution_charged
 CROSS JOIN attempts a ON a.id=c.attempt_id LEFT JOIN dispatch_outbox d ON d.attempt_id=a.id
 ${joins} WHERE c.execution_charged=1 LIMIT ${MAX_DISPATCH_CHARGED + 1}`;

export function factKey(row: DispatchFact): DispatchKey {
  return captureDispatchKey({ runId: row.run_id, attempt: { attemptId: row.attempt_id,
    organizationId: row.organization_id, workspaceId: row.workspace_id, intentDigest: row.intent_digest, generation: 1 } });
}
export function pendingFacts(db: DatabaseSync): DispatchFact[] {
  const rows = db.prepare(pendingFactsSql).all() as unknown as DispatchFact[];
  if (rows.length > MAX_DISPATCH_PENDING) throw new StorageError('queue_full');
  return rows;
}
export function chargedFacts(db: DatabaseSync): DispatchFact[] {
  const rows = db.prepare(chargedFactsSql).all() as unknown as DispatchFact[];
  if (rows.length > MAX_DISPATCH_CHARGED) throw new StorageError('unavailable');
  return rows;
}
export function originalFact(db: DatabaseSync, key: DispatchKey): DispatchFact | undefined {
  return db.prepare(`SELECT ${columns} FROM attempts a LEFT JOIN dispatch_outbox d ON d.attempt_id=a.id
    ${joins} WHERE a.id=? AND a.run_id=? AND a.organization_id=? AND a.workspace_id=? AND a.intent_digest=?`)
    .get(key.attempt.attemptId, key.runId, key.attempt.organizationId, key.attempt.workspaceId,
      key.attempt.intentDigest) as unknown as DispatchFact | undefined;
}
export function orderOf(row: DispatchFact): number {
  const order = row.queue_order ?? 0;
  if (!Number.isSafeInteger(order) || order < 0) throw new StorageError('unavailable');
  return order;
}
function requireOutputCustody(row: DispatchFact): void {
  const owned = row.foundation_owned === 1 && row.attempt_marker === row.attempt_id
    && row.output_id === row.attempt_id && row.maximum_payload_bytes === row.output_bytes
    && row.metadata_bytes === 65536 && row.charged_bytes === row.output_bytes + 65536;
  if (!owned) throw new StorageError('unavailable');
}
function requireAcknowledgedCustody(row: DispatchFact): void {
  if (row.generation !== 1 || row.snapshot_present !== 1 || row.delivery_attempt_id !== null
    || row.possible_delivery !== null) throw new StorageError('unavailable');
}
function requireReplayCustody(row: DispatchFact): void {
  const replay = row.execution_charged === 1 && row.generation === null && row.snapshot_present === 0
    && row.delivery_attempt_id === row.attempt_id && row.possible_delivery === 1
    && row.outbox_marker === row.attempt_id && row.first_delivery_at !== null;
  if (!replay) throw new StorageError('unavailable');
}
export function retainedClaim(row: DispatchFact): 'acknowledged' | 'replay' | null {
  if (row.record_id === null) {
    if ((row.queue_order !== null && row.possible_delivery === 1) || row.output_id !== null) throw new StorageError('unavailable');
    return null;
  }
  requireOutputCustody(row);
  if (row.acknowledged_generation === 1) {
    requireAcknowledgedCustody(row);
    return 'acknowledged';
  }
  requireReplayCustody(row);
  return 'replay';
}
