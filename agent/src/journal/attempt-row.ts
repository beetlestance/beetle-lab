import { storedJson as json } from './row-values.js';
import { validate } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import { copyWrapperCheckpoint } from '../control-protocol/index.js';
import { Failure } from './failure.js';
export interface Row {
  id: number;
  attempt_id: string;
  organization_id: string;
  workspace_id: string;
  intent_digest: string;
  execution_purpose: 'performance' | 'standalone_export';
  generation: number;
  state: AttemptSnapshot['state'];
  last_seq: number;
  cancel_requested: number;
  retained_start_seq: number;
  acknowledged_seq: number;
  spool_bytes: number;
  spool_rows: number;
  quota_bytes: number;
  hold_bytes: number;
  collection_bytes: number;
  source_bytes: number;
  delivery_bytes: number;
  delivery_pending: number;
  absence_bytes: number;
  absence_pending: number;
  cleanup_control_version: number;
  cleanup_control_bytes: number;
  staging_namespace_identity: string | null;
  wrapper_high: number;
  supervisor_high: number;
  wrapper_expired: number;
  supervisor_expired: number;
  checkpoint_bytes: number;
  wrapper_checkpoint_json: string | null;
  phase: NonNullable<AttemptSnapshot['phase']> | null;
  exit_json: string | null;
  exit_facts_json: string | null;
  result_json: string | null;
  export_result_json: string | null;
  snapshot_bytes: number;
}

export function snapshot(row: Row): AttemptSnapshot {
  const candidate = {
    protocolVersion: '1.0',
    attemptId: row.attempt_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    intentDigest: row.intent_digest,
    generation: row.generation,
    state: row.state,
    lastSeq: row.last_seq,
    retainedStartSeq: row.retained_start_seq,
    cancelRequested: row.cancel_requested === 1,
    ...(row.phase === null ? {} : { phase: row.phase }),
    ...(row.exit_json === null ? {} : { exitEvidence: json(row.exit_json, 1024) }),
    ...(row.export_result_json == null ? {} : { exportResult: json(row.export_result_json, 8192) }),
    ...(row.result_json === null ? {} : { result: json(row.result_json, 65536) }),
  };
  const result = validate('AttemptSnapshot', candidate);
  if (!result.ok) throw new Failure('unavailable');
  bindResults(row, result.value);
  return result.value;
}

const counters = [
  'id',
  'generation',
  'last_seq',
  'retained_start_seq',
  'acknowledged_seq',
  'spool_bytes',
  'spool_rows',
  'quota_bytes',
  'hold_bytes',
  'collection_bytes',
  'source_bytes',
  'delivery_bytes',
  'absence_bytes',
  'cleanup_control_bytes',
  'wrapper_high',
  'supervisor_high',
  'wrapper_expired',
  'supervisor_expired',
  'checkpoint_bytes',
  'snapshot_bytes',
] as const;
const flags = ['cancel_requested', 'delivery_pending', 'absence_pending', 'cleanup_control_version'] as const;
function integer(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function exitFacts(row: Row, captured: AttemptSnapshot): void {
  if (row.exit_facts_json !== null) {
    const facts = json(row.exit_facts_json, 1024);
    if (
      !facts ||
      typeof facts !== 'object' ||
      Array.isArray(facts) ||
      !captured.exitEvidence ||
      Object.keys(facts).some((name) => !['exitCode', 'oomKilled', 'reason'].includes(name))
    )
      throw new Failure('unavailable');
    // Accumulated facts deliberately omit time; the immutable public witness owns it.
    snapshot({
      ...row,
      result_json: null,
      export_result_json: null,
      exit_json: JSON.stringify({ ...facts, observedAt: captured.exitEvidence.observedAt }),
    });
  }
}
function privateFacts(row: Row, captured: AttemptSnapshot): void {
  if (
    row.staging_namespace_identity !== null &&
    (typeof row.staging_namespace_identity !== 'string' || !/^[a-f0-9]{64}$/.test(row.staging_namespace_identity))
  )
    throw new Failure('unavailable');
  exitFacts(row, captured);
  if (row.wrapper_checkpoint_json !== null) {
    try {
      copyWrapperCheckpoint(json(row.wrapper_checkpoint_json, 1024));
    } catch {
      throw new Failure('unavailable');
    }
  }
}
function sequences(row: Row): void {
  if (row.id < 1 || row.generation !== 1 || row.last_seq >= Number.MAX_SAFE_INTEGER) throw new Failure('unavailable');
  if (row.acknowledged_seq > row.last_seq || row.retained_start_seq > row.last_seq + 1)
    throw new Failure('unavailable');
  if (row.wrapper_expired > row.wrapper_high || row.supervisor_expired > row.supervisor_high)
    throw new Failure('unavailable');
}
/** Capture every serving-path field before using it for projection or accounting. */
export function captureAttemptRow(input: unknown): Row {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Failure('unavailable');
  const fields = input as Record<string, unknown>;
  if (!counters.every((name) => integer(fields[name]))) throw new Failure('unavailable');
  if (!flags.every((name) => fields[name] === 0 || fields[name] === 1)) throw new Failure('unavailable');
  if (fields.execution_purpose !== 'performance' && fields.execution_purpose !== 'standalone_export')
    throw new Failure('unavailable');
  const row = input as Row;
  const captured = snapshot(row);
  privateFacts(row, captured);
  sequences(row);
  return row;
}

function bindResults(row: Row, value: AttemptSnapshot): void {
  for (const result of [value.result, value.exportResult]) {
    if (result === undefined) continue;
    if (
      result.attemptId !== row.attempt_id ||
      result.organizationId !== row.organization_id ||
      result.workspaceId !== row.workspace_id ||
      result.generation !== row.generation
    )
      throw new Failure('unavailable');
  }
}
