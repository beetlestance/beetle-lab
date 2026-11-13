import { reserveCleanupControl } from '../cleanup-control/index.js';
import type { CleanupCapacity } from '../cleanup-control/index.js';
import { retirementRequest } from './retirement-request.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputDeletionCommand, OutputDeletionOperation, OutputDeletionSummary, OutputDeletionValue,
  OutputDeletionPlanWrite, OutputDeletionAbsenceWrite, OutputDeletionFile, OutputDeletionScan } from '../../../../ports/output-deletion-metadata.js';
import type { OutputDeletionRequest } from '../../../../ports/output-deletion.js';
import { prepareOutputDeletion } from '../../../../application/output-deletion/index.js';
import { StorageError } from '../protocol.js';
import { lower, sha256 } from '../input-values.js';
import { transaction } from '../schema.js';
import { captureFacts } from './facts.js';
import { file, parent, summary } from './rows.js';
import { captureDeletionOperation } from './requests.js';
import { captureDeletionReply } from './replies.js';
import { cursor, position } from './cursor.js';
export { deletionOperation, captureDeletionOperation } from './requests.js';
export { captureDeletionReply, deletionReplyLimit } from './replies.js';
/** Intent/progress only; existing source, receipt and charge authority is retained. */
export class OutputDeletions {
  constructor(private readonly db: DatabaseSync, private readonly runs: {get(key: RunKey): Run}, private readonly capacity:()=>CleanupCapacity) {}
  /** Participates in Store's shared receipt-first transaction; never a standalone mutation. */
  begin(input: OutputDeletionCommand): OutputDeletionSummary {
    const command = prepareOutputDeletion(input, sha256); const facts = captureFacts(this.db, this.runs, command); const run = facts.run;
    if (this.db.prepare('SELECT id FROM output_deletion_intents WHERE run_id=?').get(run.id)) throw new StorageError('conflict');
    reserveCleanupControl(this.db,{runId:run.id,attemptId:run.activeAttemptId,organizationId:run.scope.organizationId,workspaceId:run.scope.workspaceId},this.capacity);
    this.db.prepare(`INSERT INTO output_deletion_intents(id,run_id,attempt_id,organization_id,workspace_id,request_id,run_version,
      deletion_version,version,kind,requested_at,closure_digest,retained_payload_bytes,metadata_bytes,file_count,pending_files)
      VALUES(?,?,?,?,?,?,?,1,1,?,?,?,?,?,?,?)`).run(lower(command.id), run.id, run.activeAttemptId, run.scope.organizationId, run.scope.workspaceId,
      lower(command.request.requestId), run.version, facts.kind, command.requestedAt, facts.closureDigest, facts.retainedPayloadBytes, facts.metadataBytes,
      facts.versions.length, facts.versions.length);
    const insert = this.db.prepare(`INSERT INTO output_deletion_files(deletion_id,attempt_id,ordinal,original_version,version,absent) VALUES(?,?,?,?,1,0)`);
    facts.versions.forEach((version, ordinal) => insert.run(lower(command.id), run.activeAttemptId, ordinal, version));
    const value = summary(this.db, {id: command.id, scope: run.scope, runId: run.id});
    return captureDeletionReply({kind: 'beginOutputDeletion', command}, value) as OutputDeletionSummary;
  }
  execute(input: OutputDeletionOperation): OutputDeletionValue {
    const operation = captureDeletionOperation(input);
    return transaction(this.db, () => captureDeletionReply(operation, this.change(operation)));
  }
  private change(operation: OutputDeletionOperation): OutputDeletionValue {
    switch (operation.kind) {
      case 'reserveOutputCleanupControl': {
        const row=parent(this.db,operation.key);
        reserveCleanupControl(this.db,{runId:row.run_id as string,attemptId:row.attempt_id as string,organizationId:row.organization_id as string,workspaceId:row.workspace_id as string},this.capacity);
        return summary(this.db,operation.key);
      }
      case 'getOutputRetirementRequest': return retirementRequest(this.db, this.runs, operation.key);
      case 'getOutputDeletion': return summary(this.db, operation.key);
      case 'getOutputDeletionFile': return file(this.db, operation.key);
      case 'recordOutputDeletionPlan': return this.plan(operation.request);
      case 'recordOutputDeletionAbsence': return this.absence(operation.request);
      case 'scanOutputDeletions': return this.scan(operation.query);
      default: throw new StorageError('invalid_input');
    }
  }
  private plan(request: OutputDeletionPlanWrite): OutputDeletionFile {
    const current = file(this.db, request.key); const expected = this.nativeIntent(current);
    const provided = request.plan;
    const wanted = {...expected, namespaceIdentity: provided.namespaceIdentity, preparationIdentity: provided.preparationIdentity};
    this.exact(provided, wanted);
    if (current.phase !== 'pending_preparation') {this.exact(provided, this.nativePlan(current)); return current;}
    const intent = parent(this.db, request.key);
    if (intent.namespace_identity !== null && intent.namespace_identity !== provided.namespaceIdentity) throw new StorageError('conflict');
    this.version(current, request.expectedVersion);
    this.db.prepare(`UPDATE output_deletion_files SET namespace_identity=?,preparation_identity=?,version=2 WHERE deletion_id=? AND ordinal=?`)
      .run(provided.namespaceIdentity, provided.preparationIdentity, current.deletionId, request.key.ordinal);
    return file(this.db, request.key);
  }
  private absence(request: OutputDeletionAbsenceWrite): OutputDeletionFile {
    const current = file(this.db, request.key); const expected = {...this.nativePlan(current), phase: 'absent'};
    this.exact(request.receipt, expected);
    if (current.phase === 'absent') return current;
    this.version(current, request.expectedVersion);
    this.db.prepare('UPDATE output_deletion_files SET version=3,absent=1 WHERE deletion_id=? AND ordinal=?').run(current.deletionId, request.key.ordinal);
    return file(this.db, request.key);
  }
  private nativeIntent(value: OutputDeletionFile) {return {record: value.record, deletionId: value.deletionId, deletionVersion: value.deletionVersion};}
  private nativePlan(value: OutputDeletionFile): OutputDeletionRequest {
    if (value.namespaceIdentity === null || value.preparationIdentity === null) throw new StorageError('conflict');
    return {...this.nativeIntent(value), namespaceIdentity: value.namespaceIdentity, preparationIdentity: value.preparationIdentity};
  }
  private exact(actual: unknown, expected: unknown): void {
    if (encodeCanonicalJson(actual, 8192) !== encodeCanonicalJson(expected, 8192)) throw new StorageError('conflict');
  }
  private version(value: OutputDeletionFile, expected: number): void {if (value.version !== expected) throw new StorageError('conflict');}
  private scan(query: OutputDeletionScan) {
    const rows = this.db.prepare(`SELECT id,run_id,organization_id,workspace_id,sequence FROM output_deletion_intents
      WHERE pending_files>0 AND sequence>? ORDER BY sequence LIMIT ?`).all(position(query), query.limit + 1);
    const selected = rows.slice(0, query.limit); const last = selected.at(-1);
    return {items: selected.map(row => summary(this.db, {id: row.id as string, runId: row.run_id as string,
      scope: {kind: 'workspace', organizationId: row.organization_id as string, workspaceId: row.workspace_id as string}})),
      nextCursor: rows.length > query.limit && last ? cursor(last.sequence as number, query.limit) : null};
  }
}
