import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { EventBinding } from '../../../../ports/events.js';
import type { OutputAbsenceState, OutputAbsenceFinalizeRequest, OutputAbsenceFinalizationReply } from '../../../../ports/output-absence.js';
import { requireRetainedOriginal } from '../output-custody/index.js';
import { requireCurrentRun, checkFinalHeader, seedZeroCursor, requireRetention } from '../output-finalization/index.js';
import { transaction } from '../schema.js';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { captureAbsenceOperation, captureAbsenceReply, captureAbsenceState } from './wire.js';
import type { AbsenceOperation, AbsenceValue } from './wire.js';
export { absenceOperation, captureAbsenceOperation, captureAbsenceReply } from './wire.js';
export type { AbsenceOperation } from './wire.js';
type Row = Record<string, SQLOutputValue>;
/** Bounded canonical proof custody and atomic settlement; no remote IO or inferred observations. */
export class OutputAbsences {
  constructor(private readonly db: DatabaseSync) {}
  execute(input: AbsenceOperation): AbsenceValue {
    const operation = captureAbsenceOperation(input);
    const result = transaction(this.db, () => {
      switch (operation.kind) {
        case 'absenceRead': return this.read(operation.binding);
        case 'absenceAdopt': return this.adopt(operation.request.binding, operation.request.closure);
        case 'absenceFinalize': return this.finalize(operation.request);
      }
    });
    return captureAbsenceReply(operation, result);
  }
  private read(binding: EventBinding): OutputAbsenceState | null {
    // Reuse the retained original's exact physical/scoped identity check.
    requireRetainedOriginal(this.db, binding);
    if (this.db.prepare('SELECT attempt_id FROM execution_output_sources WHERE attempt_id=?').get(binding.key.attempt.attemptId)) {
      throw new StorageError('conflict');
    }
    const row = this.db.prepare(`SELECT proof_digest,CASE WHEN length(CAST(proof_json AS BLOB))<=2048 THEN proof_json ELSE NULL END proof_json
      FROM execution_output_absences WHERE attempt_id=?`).get(binding.key.attempt.attemptId);
    if (!row) return null;
    if (typeof row.proof_json !== 'string') throw new StorageError('unavailable');
    try { return captureAbsenceState({ binding, proofDigest: row.proof_digest, closure: JSON.parse(row.proof_json) as unknown }, binding); }
    catch { throw new StorageError('unavailable'); }
  }
  private adopt(binding: EventBinding, input: unknown): OutputAbsenceState {
    const closure = captureOutputAbsence(input, { ...binding.key.attempt, journalAuthority: binding.journalAuthority });
    const text = encodeCanonicalJson(closure, 2048); const previous = this.read(binding);
    if (previous) {
      if (encodeCanonicalJson(previous.closure, 2048) !== text) throw new StorageError('conflict');
      return previous;
    }
    const a = binding.key.attempt;
    this.db.prepare(`INSERT INTO execution_output_absences(attempt_id,run_id,organization_id,workspace_id,intent_digest,
      journal_authority,generation,proof_digest,final_agent_seq,proof_json) VALUES(?,?,?,?,?,?,1,?,?,?)`)
      .run(a.attemptId, binding.key.runId, a.organizationId, a.workspaceId, a.intentDigest, binding.journalAuthority,
        sha256(text), closure.finalAgentSeq, text);
    return { binding, closure, proofDigest: sha256(text) };
  }
  private finalize(request: OutputAbsenceFinalizeRequest): OutputAbsenceFinalizationReply {
    const proof = this.read(request.binding); const attempt = request.binding.key.attempt.attemptId;
    const previous = this.db.prepare('SELECT * FROM execution_output_absence_finalizations WHERE attempt_id=?').get(attempt);
    if (proof && proof.proofDigest !== request.proofDigest) throw new StorageError('conflict');
    if (previous) return this.receipt(request, previous);
    requireCurrentRun(this.db, request.binding, request.expectedRunVersion);
    if (!proof) return { kind: 'pending', reason: 'proof' };
    if (!checkFinalHeader(this.db, attempt, proof.closure.finalAgentSeq)) return { kind: 'pending', reason: 'execution' };
    if (proof.closure.finalAgentSeq === 0) seedZeroCursor(this.db, request.binding);
    const row = this.db.prepare('SELECT * FROM output_absence_evidence WHERE attempt_id=?').get(attempt);
    if (!row) throw new StorageError('unavailable');
    const pending = this.pending(row);
    if (pending) return pending;
    requireRetention(row.retained_payload_bytes, row.maximum_payload_bytes);
    this.db.prepare(`INSERT INTO execution_output_absence_finalizations SELECT attempt_id,run_id,organization_id,workspace_id,
      intent_digest,journal_authority,generation,proof_digest,final_agent_seq,retained_payload_bytes,
      maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
      FROM output_absence_evidence WHERE attempt_id=?`).run(attempt);
    const committed = this.db.prepare('SELECT * FROM execution_output_absence_finalizations WHERE attempt_id=?').get(attempt);
    if (!committed) throw new StorageError('unavailable');
    return this.receipt(request, committed);
  }
  private pending(row: Row): OutputAbsenceFinalizationReply | null {
    if (row.execution_ready !== 1) return { kind: 'pending', reason: 'execution' };
    if (row.events_ready !== 1) return { kind: 'pending', reason: 'events' };
    return null;
  }
  private receipt(request: OutputAbsenceFinalizeRequest, row: Row): OutputAbsenceFinalizationReply {
    const result = captureAbsenceReply({ kind: 'absenceFinalize', request }, { kind: 'finalized', receipt: {
      binding: request.binding, proofDigest: row.proof_digest, finalAgentSeq: row.final_agent_seq,
      retainedPayloadBytes: row.retained_payload_bytes, refundedBytes: row.refunded_bytes, runVersion: row.run_version,
      state: row.state, outcome: row.outcome, validationStatus: row.validation_status, reason: row.reason } });
    return result as OutputAbsenceFinalizationReply;
  }
}
