import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { OutputDeletionSummary, OutputDeletionFile, OutputDeletionKey, OutputDeletionFileKey } from '../../../../ports/output-deletion-metadata.js';
import { loadOutput } from '../output-custody/index.js';
import { StorageError } from '../protocol.js';
import { lower } from '../input-values.js';
import { binding } from './facts.js';
export type Row = Record<string, SQLOutputValue>;
export function parent(db: DatabaseSync, key: OutputDeletionKey): Row {
  const row = db.prepare(`SELECT * FROM output_deletion_intents WHERE id=? AND run_id=? AND organization_id=? AND workspace_id=?`)
    .get(lower(key.id), lower(key.runId), lower(key.scope.organizationId), lower(key.scope.workspaceId));
  if (!row) throw new StorageError('not_found'); return row;
}
export function summary(db: DatabaseSync, key: OutputDeletionKey): OutputDeletionSummary {
  const row = parent(db, key); const counts = db.prepare(`SELECT count(*) files,coalesce(sum(preparation_identity IS NOT NULL),0) prepared,
    coalesce(sum(absent),0) absent FROM output_deletion_files WHERE deletion_id=?`).get(lower(key.id))!;
  if (counts.files !== row.file_count || counts.absent !== Number(row.file_count) - Number(row.pending_files)) throw new StorageError('unavailable');
  return {id: row.id as string, scope: {kind: 'workspace', organizationId: row.organization_id as string, workspaceId: row.workspace_id as string},
    requestId: row.request_id as string, runId: row.run_id as string, runVersion: row.run_version as number, deletionVersion: 1, version: row.version as number,
    kind: row.kind as OutputDeletionSummary['kind'], stage: row.pending_files === 0 ? 'files_absent' : 'pending',
    fileCount: row.file_count as number, preparedCount: counts.prepared as number, absentCount: counts.absent as number,
    retainedPayloadBytes: row.retained_payload_bytes as number, metadataBytes: row.metadata_bytes as number, requestedAt: row.requested_at as string};
}
export function file(db: DatabaseSync, key: OutputDeletionFileKey): OutputDeletionFile {
  const intent = parent(db, key); const row = db.prepare('SELECT * FROM output_deletion_files WHERE deletion_id=? AND ordinal=?').get(lower(key.id), key.ordinal);
  if (!row) throw new StorageError('not_found');
  const owned = binding(db, intent.run_id as string, intent.attempt_id as string); const output = loadOutput(db, owned);
  if (output.kind !== 'adopted' || output.sourceDigest !== intent.closure_digest) throw new StorageError('unavailable');
  const artifact = output.artifacts[key.ordinal]; if (!artifact || artifact.version !== row.original_version) throw new StorageError('unavailable');
  return {deletionId: intent.id as string, deletionVersion: 1, record: {binding: owned, artifact}, version: row.version as number,
    phase: row.absent === 1 ? 'absent' : row.preparation_identity === null ? 'pending_preparation' : 'prepared',
    namespaceIdentity: row.namespace_identity as string | null, preparationIdentity: row.preparation_identity as string | null};
}
