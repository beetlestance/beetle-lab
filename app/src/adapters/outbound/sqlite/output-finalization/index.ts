import { requireCurrentRun, checkFinalHeader, seedZeroCursor, requireRetention } from './facts.js';
export { requireCurrentRun, checkFinalHeader, seedZeroCursor, requireRetention, finalEventsReady } from './facts.js';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
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
    requireCurrentRun(this.db, binding, request.expectedRunVersion);
    if (!source) return { kind: 'pending', reason: 'source' };
    this.requireDigests(request, source.sourceDigest, source.manifest.manifestDigest);
    checkFinalHeader(this.db, a.attemptId, source.closure.finalAgentSeq);
    if (source.closure.finalAgentSeq === 0) seedZeroCursor(this.db, binding);
    const row = this.db.prepare('SELECT * FROM output_finalization_evidence WHERE attempt_id=?').get(a.attemptId);
    if (!row) throw new StorageError('unavailable');
    const pending = this.pending(request, row);
    if (pending) return pending;
    requireRetention(row.retained_payload_bytes, row.maximum_payload_bytes);
    this.db.prepare(`INSERT INTO execution_output_finalizations SELECT attempt_id,run_id,organization_id,workspace_id,
      intent_digest,journal_authority,generation,source_digest,manifest_digest,final_agent_seq,retained_payload_bytes,
      maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
      FROM output_finalization_evidence WHERE attempt_id=?`).run(a.attemptId);
    const committed = this.db.prepare('SELECT * FROM execution_output_finalizations WHERE attempt_id=?').get(a.attemptId);
    if (!committed) throw new StorageError('unavailable');
    return receipt(request, committed);
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
}
