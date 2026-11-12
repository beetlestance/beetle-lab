import { encodeCanonicalJson } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { RunHistorySummary } from '@beetle/contracts/api';
import type { RunHistoryJob } from '../../../../ports/run-history.js';
import { transaction } from '../schema.js';
import { StorageError } from '../protocol.js';
import { captureHistoryOperation, captureHistoryReply } from './wire.js';
import type { HistoryOperation } from './wire.js';
export { captureHistoryOperation, captureHistoryReply, historyOperation } from './wire.js';
export type { HistoryOperation } from './wire.js';
export { readHistorySummaries } from './reads.js';
interface Row { state: string; id: string; organization_id: string; workspace_id: string; active_attempt_id: string; history_summary_due_ms: number;
  history_summary_json: string | null; manifest_digest: string | null; source_digest: string | null; proof_digest: string | null }
const facts = `SELECT r.id,r.organization_id,r.workspace_id,r.active_attempt_id,r.state,r.history_summary_due_ms,r.history_summary_json,
 f.manifest_digest,f.source_digest,z.proof_digest FROM runs r
 LEFT JOIN execution_output_finalizations f ON f.attempt_id=r.active_attempt_id
 LEFT JOIN execution_output_absence_finalizations z ON z.attempt_id=r.active_attempt_id`;
export const historyScanSql = facts.replace('FROM runs r', 'FROM runs r INDEXED BY run_history_due') + `
        WHERE r.state IN ('finished','cancelled','errored') AND r.history_summary_json IS NULL
        AND r.history_summary_due_ms<=? ORDER BY r.history_summary_due_ms,r.id LIMIT ?`;
function job(row: Row): RunHistoryJob {
  return { id: row.id, scope: { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id },
    attemptId: row.active_attempt_id, manifestDigest: row.manifest_digest, sourceDigest: row.source_digest,
    absenceProofDigest: row.proof_digest, expectedDueMs: row.history_summary_due_ms };
}
export class HistorySummaries {
  constructor(private readonly db: DatabaseSync) {}
  execute(input: HistoryOperation): RunHistoryJob[] | RunHistorySummary | null {
    const operation = captureHistoryOperation(input);
    return transaction(this.db, () => captureHistoryReply(operation, this.apply(operation)));
  }
  private apply({ operation }: HistoryOperation): RunHistoryJob[] | RunHistorySummary | null {
    if (operation.method === 'scan') {
      return (this.db.prepare(historyScanSql)
        .all(operation.query.nowMs, operation.query.limit) as unknown as Row[]).map(job);
    }
    const expected = operation.request.job;
    const row = this.current(expected);
    if (operation.method === 'commit') return this.commit(expected, row, operation.request.summary);
    const dueMs = operation.request.dueMs;
    if (row.history_summary_json !== null) throw new StorageError('conflict');
    if (row.history_summary_due_ms === dueMs) return null;
    if (row.history_summary_due_ms !== expected.expectedDueMs) throw new StorageError('conflict');
    this.db.prepare('UPDATE runs SET history_summary_due_ms=? WHERE id=?').run(dueMs, expected.id);
    return null;
  }
  private current(expected: RunHistoryJob): Row {
    const row = this.db.prepare(facts + ' WHERE r.id=? AND r.organization_id=? AND r.workspace_id=?')
      .get(expected.id, expected.scope.organizationId, expected.scope.workspaceId) as unknown as Row | undefined;
    if (!row) throw new StorageError('not_found');
    if (!['finished', 'cancelled', 'errored'].includes(row.state)) throw new StorageError('conflict');
    const actual = job(row);
    if (actual.attemptId !== expected.attemptId || actual.manifestDigest !== expected.manifestDigest
      || actual.sourceDigest !== expected.sourceDigest || actual.absenceProofDigest !== expected.absenceProofDigest) throw new StorageError('conflict');
    return row;
  }
  private commit(expected: RunHistoryJob, row: Row, summary: RunHistorySummary): RunHistorySummary {
    const text = encodeCanonicalJson(summary, 2048);
    if (row.history_summary_json !== null) {
      if (row.history_summary_json !== text) throw new StorageError('conflict');
      return summary;
    }
    if (row.history_summary_due_ms !== expected.expectedDueMs) throw new StorageError('conflict');
    this.db.prepare('UPDATE runs SET history_summary_json=? WHERE id=?').run(text, expected.id);
    return summary;
  }
}
