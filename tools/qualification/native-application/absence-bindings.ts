import assert from 'node:assert/strict';
import type { SQLOutputValue } from 'node:sqlite';
import type { OutputAbsence } from '@beetle/contracts/output-source';

type Row = Record<string, SQLOutputValue>;
type Scope = Pick<OutputAbsence, 'attemptId' | 'organizationId' | 'workspaceId'>;
function scopedRow(row: Row, proof: Scope, runId: string) {
  for (const [column, expected] of Object.entries({ attempt_id: proof.attemptId, run_id: runId,
    organization_id: proof.organizationId, workspace_id: proof.workspaceId })) assert.equal(row[column], expected, column);
}
/** Check relational ownership independently of the embedded snapshot and its FKs. */
export function executionBinding(row: Row, proof: OutputAbsence, runId: string) {
  scopedRow(row, proof, runId);
  assert.equal(row.intent_digest, proof.intentDigest, 'intent_digest');
  assert.equal(row.acknowledged_generation, proof.generation, 'acknowledged_generation');
  assert.equal(row.journal_authority, proof.journalAuthority, 'journal_authority');
}
/** Validate and retain the complete immutable allocation for the reopen oracle. */
export function allocationBinding(row: Row, proof: Scope, runId: string, maximum: number) {
  scopedRow(row, proof, runId);
  assert.equal(row.version, 1, 'version');
  assert.equal(row.maximum_payload_bytes, maximum, 'maximum_payload_bytes');
  assert.equal(row.metadata_bytes, 65536, 'metadata_bytes');
  assert.equal(row.charged_bytes, maximum + 65536, 'charged_bytes');
  return row;
}
export function eventBinding(event: Scope & { generation: number }, proof: OutputAbsence) {
  for (const field of ['attemptId', 'organizationId', 'workspaceId', 'generation'] as const) {
    assert.equal(event[field], proof[field], field);
  }
}
