import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { validate } from '@beetle/contracts';
import type { OutputFinalizationReply, OutputFinalizationRequest } from '../../../../ports/output-finalization.js';
import { readEnvelope, loadOutput } from '../output-custody/index.js';
import { transaction } from '../schema.js';
import { StorageError } from '../protocol.js';
import { captureFinalizationOperation, captureFinalizationReply } from './wire.js';
import type { FinalizationOperation } from './wire.js';
export { finalizationOperation, captureFinalizationOperation, captureFinalizationReply } from './wire.js';
export type { FinalizationOperation } from './wire.js';
type Row = Record<string, SQLOutputValue>;
function receipt(request: OutputFinalizationRequest, row: Row): OutputFinalizationReply {
  return captureFinalizationReply({ kind: 'outputFinalize', request }, { kind: 'finalized', receipt: {
    binding: { key: { runId: row.run_id, attempt: { attemptId: row.attempt_id, organizationId: row.organization_id,
      workspaceId: row.workspace_id, intentDigest: row.intent_digest, generation: row.generation } }, journalAuthority: row.journal_authority },
    sourceDigest: row.source_digest, manifestDigest: row.manifest_digest, finalAgentSeq: row.final_agent_seq,
    retainedPayloadBytes: row.retained_payload_bytes, refundedBytes: row.refunded_bytes, runVersion: row.run_version,
    state: row.state, outcome: row.outcome, validationStatus: row.validation_status, reason: row.reason } });
}
/** One immediate bounded transaction, with no file/network IO or engine effects.
 * The native receipt trigger owns the only credit and terminal mutation.
 * Focused tests: app/test/output-finalization/*.test.ts.
 */
export class OutputFinalizations {
  constructor(private readonly db: DatabaseSync) {}
  execute(input: FinalizationOperation): OutputFinalizationReply {
    const operation = captureFinalizationOperation(input);
    const result = transaction(this.db, () => this.finalize(operation.request));
    return captureFinalizationReply(operation, result);
  }
  private finalize(request: OutputFinalizationRequest): OutputFinalizationReply {
    const { binding } = request; const a = binding.key.attempt;
    // The shared source reader first resolves the scoped retained original.
    const source = readEnvelope(this.db, binding);
    const previous = this.db.prepare('SELECT * FROM execution_output_finalizations WHERE attempt_id=?').get(a.attemptId);
    if (previous) {
      if (!source || source.sourceDigest !== request.sourceDigest || source.manifest.manifestDigest !== request.manifestDigest) throw new StorageError('conflict');
      return receipt(request, previous);
    }
    this.requireRun(request);
    if (!source) return { kind: 'pending', reason: 'source' };
    this.requireDigests(request, source.sourceDigest, source.manifest.manifestDigest);
    this.checkHeader(a.attemptId, source.closure.finalAgentSeq);
    if (source.closure.finalAgentSeq === 0) this.zeroCursor(request);
    const row = this.db.prepare('SELECT * FROM output_finalization_evidence WHERE attempt_id=?').get(a.attemptId);
    if (!row) throw new StorageError('unavailable');
    const pending = this.pending(request, row);
    if (pending) return pending;
    this.requireRetention(row);
    this.db.prepare(`INSERT INTO execution_output_finalizations SELECT attempt_id,run_id,organization_id,workspace_id,
      intent_digest,journal_authority,generation,source_digest,manifest_digest,final_agent_seq,retained_payload_bytes,
      maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
      FROM output_finalization_evidence WHERE attempt_id=?`).run(a.attemptId);
    const committed = this.db.prepare('SELECT * FROM execution_output_finalizations WHERE attempt_id=?').get(a.attemptId);
    if (!committed) throw new StorageError('unavailable');
    return receipt(request, committed);
  }
  private requireRun(request: OutputFinalizationRequest): void {
    const { key } = request.binding; const a = key.attempt;
    const run = this.db.prepare('SELECT active_attempt_id,version,state FROM runs WHERE id=? AND organization_id=? AND workspace_id=?')
      .get(key.runId, a.organizationId, a.workspaceId);
    if (!run) throw new StorageError('not_found');
    if (run.active_attempt_id !== a.attemptId || run.version !== request.expectedRunVersion
      || !['queued', 'dispatching', 'active', 'finalizing'].includes(String(run.state))) throw new StorageError('conflict');
  }
  private requireDigests(request: OutputFinalizationRequest, source: string, manifest: string): void {
    if (source !== request.sourceDigest || manifest !== request.manifestDigest) throw new StorageError('conflict');
  }
  private pending(request: OutputFinalizationRequest, row: Row): OutputFinalizationReply | null {
    if (row.execution_ready !== 1) return { kind: 'pending', reason: 'execution' };
    if (row.events_ready !== 1) return { kind: 'pending', reason: 'events' };
    const output = loadOutput(this.db, request.binding);
    if (output.kind !== 'adopted') throw new StorageError('unavailable');
    if (row.artifacts_ready !== 1) return { kind: 'pending', reason: 'artifacts' };
    if (row.state === null) return { kind: 'pending', reason: 'exit_evidence' };
    return null;
  }
  private requireRetention(row: Row): void {
    const retained = row.retained_payload_bytes; const maximum = row.maximum_payload_bytes;
    if (typeof retained !== 'number' || !Number.isSafeInteger(retained) || retained < 0
      || typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || retained > maximum) throw new StorageError('unavailable');
  }
  private checkHeader(attempt: string, finalAgentSeq: number): void {
    const row = this.db.prepare(`SELECT CASE WHEN length(CAST(snapshot_json AS BLOB))<=2048 THEN snapshot_json ELSE NULL END header
      FROM execution_records WHERE attempt_id=?`).get(attempt);
    if (!row) throw new StorageError('unavailable');
    if (typeof row.header !== 'string') throw new StorageError('unavailable');
    const header = validate('AttemptSnapshot', JSON.parse(row.header) as unknown);
    if (!header.ok) throw new StorageError('unavailable');
    if (header.value.lastSeq > finalAgentSeq) throw new StorageError('conflict');
  }
  private zeroCursor(request: OutputFinalizationRequest): void {
    const { key, journalAuthority } = request.binding; const a = key.attempt;
    if (this.db.prepare('SELECT attempt_id FROM event_cursors WHERE attempt_id=?').get(a.attemptId)) return;
    this.db.prepare(`INSERT INTO event_cursors(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
      VALUES(?,?,?,?,?,?,1)`).run(a.attemptId, key.runId, a.organizationId, a.workspaceId, a.intentDigest, journalAuthority);
  }
}
