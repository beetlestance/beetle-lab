import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { captureNamespaceId } from '../namespace-rows.js';
import { StorageError } from '../protocol.js';
import { captureHistoryJob } from './wire.js';
import { captureHistorySummary } from './values.js';
export interface JobRow {
  state: Run['state'];
  id: string;
  organization_id: string;
  workspace_id: string;
  active_attempt_id: string;
  history_summary_due_ms: number;
  history_summary_json: string | null;
  manifest_digest: string | null;
  source_digest: string | null;
  proof_digest: string | null;
}
export interface SummaryRow {
  id: string;
  active_attempt_id: string;
  history_summary_json: string | null;
  cleanup_bytes: number | null;
  charged_bytes: number | null;
  metadata_bytes: number | null;
  source_refund: number | null;
  absence_refund: number | null;
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  return input as Record<string, unknown>;
}
function storedSummary(input: unknown, id: string, attemptId: string): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || Buffer.byteLength(input) > 2048) throw new StorageError('unavailable');
  try {
    const summary = captureHistorySummary(JSON.parse(input) as unknown);
    if (summary.runId !== id || summary.attemptId !== attemptId) throw new StorageError('unavailable');
  } catch {
    throw new StorageError('unavailable');
  }
  return input;
}
function state(input: unknown): Run['state'] {
  const parsed = validateApi('RunListQuery', { limit: 1, state: input });
  if (!parsed.ok || parsed.value.state === undefined) throw new StorageError('unavailable');
  return parsed.value.state;
}
export function captureHistoryJobRow(input: unknown): JobRow {
  const row = record(input);
  try {
    const job = captureHistoryJob({
      id: row.id,
      scope: { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id },
      attemptId: row.active_attempt_id,
      manifestDigest: row.manifest_digest,
      sourceDigest: row.source_digest,
      absenceProofDigest: row.proof_digest,
      expectedDueMs: row.history_summary_due_ms,
    });
    return {
      state: state(row.state),
      id: job.id,
      organization_id: job.scope.organizationId,
      workspace_id: job.scope.workspaceId,
      active_attempt_id: job.attemptId,
      history_summary_due_ms: job.expectedDueMs,
      history_summary_json: storedSummary(row.history_summary_json, job.id, job.attemptId),
      manifest_digest: job.manifestDigest,
      source_digest: job.sourceDigest,
      proof_digest: job.absenceProofDigest,
    };
  } catch {
    throw new StorageError('unavailable');
  }
}
function nullableCount(input: unknown): number | null {
  if (input === null) return null;
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) throw new StorageError('unavailable');
  return input;
}
export function captureHistorySummaryRow(input: unknown): SummaryRow {
  const row = record(input);
  const id = captureNamespaceId(row).id;
  const attemptId = captureNamespaceId({ id: row.active_attempt_id }).id;
  const value: SummaryRow = {
    id,
    active_attempt_id: attemptId,
    history_summary_json: storedSummary(row.history_summary_json, id, attemptId),
    cleanup_bytes: nullableCount(row.cleanup_bytes),
    charged_bytes: nullableCount(row.charged_bytes),
    metadata_bytes: nullableCount(row.metadata_bytes),
    source_refund: nullableCount(row.source_refund),
    absence_refund: nullableCount(row.absence_refund),
  };
  accounting(value);
  return value;
}

function accounting(row: SummaryRow): void {
  if ((row.charged_bytes === null) !== (row.metadata_bytes === null)) throw new StorageError('unavailable');
  if (row.source_refund !== null && row.absence_refund !== null) throw new StorageError('unavailable');
  if ((row.source_refund ?? row.absence_refund ?? 0) > (row.charged_bytes ?? 0)) throw new StorageError('unavailable');
}
