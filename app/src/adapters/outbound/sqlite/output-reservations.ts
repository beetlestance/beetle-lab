import { reserveCleanupControl, missingCleanupControlBytes } from './cleanup-control/index.js';
import type { DatabaseSync } from 'node:sqlite';
import type { DispatchKey } from '../../../ports/dispatch.js';
import { RUN_OUTPUT_METADATA_BYTES } from '../../../ports/dispatch.js';
import { storageFits } from '../../../domain/settings/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';

/** Caller owns the immediate claim transaction and supplies freshly resolved caps. */
export function reserveRunOutput(db: DatabaseSync, key: DispatchKey,
  capacity: { allocationBytes: number; reserveBytes: number }): void {
  requireRule(db.isTransaction, 'conflict');
  requireRule(key.attempt.generation === 1);
  const row = db.prepare(`SELECT i.output_bytes,u.charged_bytes FROM execution_intents i
    JOIN execution_records e ON e.attempt_id=i.attempt_id CROSS JOIN installation_storage_usage u
    WHERE i.attempt_id=? AND i.run_id=? AND i.organization_id=? AND i.workspace_id=? AND i.intent_digest=?
    AND e.execution_charged=1 AND e.snapshot_json IS NULL AND u.id=1`).get(key.attempt.attemptId,
    key.runId, key.attempt.organizationId, key.attempt.workspaceId, key.attempt.intentDigest);
  requireRule(typeof row?.output_bytes === 'number' && typeof row.charged_bytes === 'number', 'not_found');
  const outputBytes = row.output_bytes + RUN_OUTPUT_METADATA_BYTES;
  const requestedBytes = outputBytes + missingCleanupControlBytes(db, {runId:key.runId,...key.attempt});
  requireRule(storageFits({ chargedBytes: row.charged_bytes, requestedBytes,
    allocationBytes: capacity.allocationBytes, reserveBytes: capacity.reserveBytes }), 'capacity_unavailable');
  db.prepare(`INSERT INTO attempt_output_allocations(attempt_id,run_id,organization_id,workspace_id,
    maximum_payload_bytes,metadata_bytes,charged_bytes,version) VALUES(?,?,?,?,?,?,?,1)`)
    .run(key.attempt.attemptId, key.runId, key.attempt.organizationId, key.attempt.workspaceId,
      row.output_bytes, RUN_OUTPUT_METADATA_BYTES, outputBytes);
  reserveCleanupControl(db, {runId:key.runId,...key.attempt}, () => capacity);
}
