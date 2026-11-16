import type { RetirementRequest as OutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { EventBinding } from '../../../../ports/events.js';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputDeletionCommand } from '../../../../ports/output-deletion-metadata.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { RUN_OUTPUT_METADATA_BYTES } from '../../../../ports/dispatch.js';
import { loadOutput } from '../output-custody/index.js';
import { OutputAbsences } from '../output-absence/index.js';
import { StorageError } from '../protocol.js';
import { lower } from '../input-values.js';
import { unsentWitness } from './unsent.js';
export interface DeletionFacts {retirement: {binding: EventBinding; closure: OutputRetirementRequest['closure']} | null; run: Run; kind: 'source' | 'absence' | 'unsent'; closureDigest: string | null; retainedPayloadBytes: number; metadataBytes: number; versions: readonly number[]}
export function binding(db: DatabaseSync, runId: string, attemptId: string): EventBinding {
  const row = db.prepare('SELECT * FROM execution_records WHERE run_id=? AND attempt_id=?').get(runId, attemptId);
  if (!row) throw new StorageError('not_found');
  return captureEventBinding({key: {runId, attempt: {attemptId, organizationId: row.organization_id, workspaceId: row.workspace_id,
    intentDigest: row.intent_digest, generation: row.acknowledged_generation}}, journalAuthority: row.journal_authority});
}
export function captureFacts(db: DatabaseSync, runs: {get(key: RunKey): Run}, command: Pick<OutputDeletionCommand, 'request'>): DeletionFacts {
  const request = command.request; const run = runs.get({scope: request.scope, id: request.runId});
  if (run.version !== request.expectedRunVersion || !['finished', 'cancelled', 'errored'].includes(run.state) || run.outcome === 'pending') throw new StorageError('conflict');
  const row = db.prepare('SELECT * FROM execution_records WHERE attempt_id=?').get(run.activeAttemptId);
  if (!row) {
    const witness = db.prepare(`SELECT 1 FROM attempts a WHERE a.id=? AND ${unsentWitness}`).get(run.activeAttemptId);
    if (!witness) throw new StorageError('conflict');
    return {retirement: null, run, kind: 'unsent', closureDigest: null, retainedPayloadBytes: 0, metadataBytes: 0, versions: []};
  }
  const source = db.prepare('SELECT * FROM execution_output_finalizations WHERE attempt_id=?').get(run.activeAttemptId);
  const absent = db.prepare('SELECT * FROM execution_output_absence_finalizations WHERE attempt_id=?').get(run.activeAttemptId);
  if (row.execution_charged !== 0 || row.event_pending !== 0 || Number(!!source) + Number(!!absent) !== 1) throw new StorageError('conflict');
  const owned = binding(db, lower(run.id), run.activeAttemptId);
  if (source) return sourceFacts(db, run, owned, source);
  return absenceFacts(db, run, owned, absent);
}
function absenceFacts(db: DatabaseSync, run: Run, owned: EventBinding, absent: Record<string, unknown> | undefined): DeletionFacts {
  const proof = new OutputAbsences(db).read(owned);
  if (!absent || !proof || !('proofDigest' in proof) || proof.proofDigest !== absent.proof_digest || proof.closure.finalAgentSeq !== absent.final_agent_seq) throw new StorageError('unavailable');
  return {retirement: {binding: owned, closure: {kind: 'absence', proofDigest: proof.proofDigest, finalAgentSeq: proof.closure.finalAgentSeq}}, run, kind: 'absence', closureDigest: absent.proof_digest as string, retainedPayloadBytes: absent.retained_payload_bytes as number, metadataBytes: RUN_OUTPUT_METADATA_BYTES, versions: []};
}
function sourceFacts(db: DatabaseSync, run: Run, owned: EventBinding, receipt: Record<string, unknown>): DeletionFacts {
  const output = loadOutput(db, owned);
  if (output.kind !== 'adopted' || output.sourceDigest !== receipt.source_digest || output.manifestDigest !== receipt.manifest_digest
    || output.finalAgentSeq !== receipt.final_agent_seq || output.artifacts.length > 128) throw new StorageError('unavailable');
  if (output.artifacts.some(artifact => artifact.phase !== 'published' || artifact.writer !== null || artifact.identity === null || artifact.offset !== artifact.bytes)) throw new StorageError('conflict');
  return {retirement: {binding: owned, closure: {kind: 'source', sourceDigest: output.sourceDigest, manifestDigest: output.manifestDigest, finalAgentSeq: output.finalAgentSeq}}, run, kind: 'source', closureDigest: output.sourceDigest, retainedPayloadBytes: receipt.retained_payload_bytes as number,
    metadataBytes: RUN_OUTPUT_METADATA_BYTES, versions: output.artifacts.map(artifact => artifact.version)};
}
