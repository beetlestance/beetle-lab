import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { CancelRunCommand } from '../../../ports/runs.js';
import { nextVersion } from '../../../domain/namespaces/index.js';
import type { RunReads } from './run-reads.js';
import { captureCancelRunReply } from './run-cancellation-reply.js';

/** RunReads and the bounded witness query execute inside Store's receipt transaction. */
export class RunCancellations {
  constructor(private readonly db: DatabaseSync, private readonly reads: RunReads) {}
  cancel(command: CancelRunCommand): Run {
    const key = { scope: command.request.scope, id: command.id };
    const before = this.reads.get(key);
    if (['finished', 'cancelled', 'errored'].includes(before.state)) return captureCancelRunReply(before, command);
    const unsent = this.provablyUnsent(before);
    if (!before.cancellationRequested || unsent) {
      const version = nextVersion(before.version);
      if (unsent) {
        this.db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(before.activeAttemptId);
        this.db.prepare("UPDATE runs SET cancellation_requested=1,state='cancelled',outcome='inconclusive',reason='cancelled',version=? WHERE id=?")
          .run(version, before.id);
      } else {
        this.db.prepare('UPDATE runs SET cancellation_requested=1,version=? WHERE id=?').run(version, before.id);
      }
    }
    return captureCancelRunReply(this.reads.get(key), command);
  }
  private provablyUnsent(run: Run): boolean {
    // A second attempt is contradictory local ownership for this single-original protocol.
    // LIMIT precedes interpretation and reads no immutable Offer/result payloads.
    const attempts = this.db.prepare(`SELECT id FROM attempts
      WHERE run_id=? AND organization_id=? AND workspace_id=? ORDER BY ordinal LIMIT 2`)
      .all(run.id, run.scope.organizationId, run.scope.workspaceId);
    if (attempts.length !== 1 || attempts[0]?.id !== run.activeAttemptId) return false;
    const witness = this.db.prepare(`SELECT 1 FROM attempts a
      JOIN dispatch_outbox d ON d.attempt_id=a.id AND d.intent_digest=a.intent_digest
      JOIN execution_intents i ON i.attempt_id=a.id AND i.run_id=a.run_id
        AND i.organization_id=a.organization_id AND i.workspace_id=a.workspace_id AND i.intent_digest=a.intent_digest
      WHERE a.id=? AND a.run_id=? AND a.organization_id=? AND a.workspace_id=?
        AND a.foundation_owned=1 AND a.execution_intent_id=a.id AND d.execution_intent_id=a.id
        AND a.generation IS NULL AND a.state='offered' AND d.possible_delivery=0 AND d.first_delivery_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM execution_records WHERE attempt_id=a.id)
        AND NOT EXISTS(SELECT 1 FROM attempt_output_allocations WHERE attempt_id=a.id) LIMIT 1`)
      .get(run.activeAttemptId, run.id, run.scope.organizationId, run.scope.workspaceId);
    return witness !== undefined;
  }
}
