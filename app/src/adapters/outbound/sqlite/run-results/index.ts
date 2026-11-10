import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Run, RunResultSnapshot } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { EventBinding } from '../../../../ports/events.js';
import type { RunReads } from '../run-reads.js';
import { readEnvelope } from '../output-custody/index.js';
import { transaction } from '../schema.js';
import { StorageError } from '../protocol.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { captureResultOperation, captureResultReply } from './wire.js';
export { resultOperation, captureResultOperation, captureResultReply } from './wire.js';
export type { ResultOperation } from './wire.js';

function retainedOwner(row: Record<string, SQLOutputValue>, run: Run): void {
  if (row.run_id !== null && (row.run_id !== run.id || row.organization_id !== run.scope.organizationId
    || row.workspace_id !== run.scope.workspaceId || row.retained_digest !== row.intent_digest)) throw new StorageError('conflict');
}

/** Scoped, read-only projection of the retained sole manifest. No files, caches,
 * terminal transitions or publication effects. One transaction owns all reads.
 * Request <=4096 bytes, reply <=73728; uses the shared bounded Offer/source reader.
 * Missing scoped runs fail not_found; corrupt sources fail explicitly. Synchronous
 * reads finish before worker reply ownership releases; no detached cancellation.
 * Focused command: vitest run app/test/run-results/*.test.ts.
 */
export class RunResults {
  constructor(private readonly db: DatabaseSync, private readonly runs: RunReads) {}
  get(input: RunKey): RunResultSnapshot {
    const { key } = captureResultOperation({ kind: 'getRunResult', key: input });
    return transaction(this.db, () => {
      const run = this.runs.get(key);
      const binding = this.binding(run);
      const source = binding === null ? null : readEnvelope(this.db, binding);
      if (source !== null) {
        const engine = source.manifest.binding.engine;
        if (engine.id !== run.engine.id || engine.imageDigest !== run.engine.imageDigest
          || engine.configVersion !== run.engine.configVersion) throw new StorageError('conflict');
      }
      return captureResultReply(key, { id: run.id, scope: run.scope, activeAttemptId: run.activeAttemptId,
        result: source?.manifest.result ?? null });
    });
  }
  private binding(run: Run): EventBinding | null {
    const row = this.db.prepare(`SELECT t.intent_digest,t.generation,e.acknowledged_generation,e.journal_authority,
      e.run_id,e.organization_id,e.workspace_id,e.intent_digest retained_digest,
      EXISTS(SELECT 1 FROM execution_output_sources s WHERE s.attempt_id=t.id) has_source
      FROM attempts t LEFT JOIN execution_records e ON e.attempt_id=t.id
      WHERE t.id=? AND t.run_id=? AND t.organization_id=? AND t.workspace_id=?`)
      .get(run.activeAttemptId, run.id, run.scope.organizationId, run.scope.workspaceId);
    if (!row) throw new StorageError('unavailable');
    retainedOwner(row, run);
    if (row.acknowledged_generation === null) {
      if (row.has_source !== 0 || row.generation !== null) throw new StorageError('unavailable');
      return null;
    }
    if (row.acknowledged_generation !== 1 || row.generation !== 1) throw new StorageError('unavailable');
    return captureEventBinding({ key: { runId: run.id, attempt: {
      organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId,
      attemptId: run.activeAttemptId, intentDigest: row.intent_digest, generation: 1 } }, journalAuthority: row.journal_authority });
  }
}
