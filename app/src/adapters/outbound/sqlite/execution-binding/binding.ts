import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { EventBinding } from '../../../../ports/events.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { StorageError } from '../protocol.js';
function retainedOwner(row: Record<string, SQLOutputValue>, run: Run): void {
  if (row.run_id !== null && (row.run_id !== run.id || row.organization_id !== run.scope.organizationId
    || row.workspace_id !== run.scope.workspaceId || row.retained_digest !== row.intent_digest)) throw new StorageError('conflict');
}

/** Live authority additionally requires an exact retained run/scope/intent owner. */
export function readExecutionBinding(db: DatabaseSync, run: Run, purpose: 'published' | 'live'): EventBinding | null {
    const row = db.prepare(`SELECT t.intent_digest,t.generation,e.acknowledged_generation,e.journal_authority,
      e.run_id,e.organization_id,e.workspace_id,e.intent_digest retained_digest,
      EXISTS(SELECT 1 FROM execution_output_sources s WHERE s.attempt_id=t.id) has_source
      FROM attempts t LEFT JOIN execution_records e ON e.attempt_id=t.id
      WHERE t.id=? AND t.run_id=? AND t.organization_id=? AND t.workspace_id=?`)
      .get(run.activeAttemptId, run.id, run.scope.organizationId, run.scope.workspaceId);
    if (!row) throw new StorageError('unavailable');
    retainedOwner(row, run);
    if (purpose === 'live' && row.run_id === null) return null;
    if (row.acknowledged_generation === null) {
      if (row.has_source !== 0 || row.generation !== null) throw new StorageError('unavailable');
      return null;
    }
    if (row.acknowledged_generation !== 1 || row.generation !== 1) throw new StorageError('unavailable');
    return captureEventBinding({ key: { runId: run.id, attempt: {
      organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId,
      attemptId: run.activeAttemptId, intentDigest: row.intent_digest, generation: 1 } }, journalAuthority: row.journal_authority });
}
