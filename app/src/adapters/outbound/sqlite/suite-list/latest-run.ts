import type { DatabaseSync } from 'node:sqlite';
import { suiteGroupOf, validateApi } from '@beetle/contracts/api';
import type { SuiteLatestRun, WorkspaceScope } from '@beetle/contracts/api';
import { sqlTextColumn } from '../sql-columns.js';
import { StorageError } from '../protocol.js';
import { latestRunPresentation } from './presentation.js';
import { publicGroup } from './statements.js';
import type { SuiteKey } from './statements.js';

const latestRunColumns = [
  sqlTextColumn('id', 45, false, 'r.'),
  sqlTextColumn('suite_id', 45, false, 'r.'),
  sqlTextColumn('state', 64, false, 'r.'),
  sqlTextColumn('outcome', 64, false, 'r.'),
  sqlTextColumn('requested_at', 40, false, 'r.'),
  sqlTextColumn('active_attempt_id', 45, false, 'r.'),
  sqlTextColumn('history_summary_json', 2048, true, 'r.'),
  sqlTextColumn('name', 512, false, 's.', 'suite_name'),
].join(',');
export const latestRunHeaderSql = `SELECT ${latestRunColumns} FROM runs r JOIN suites s
  ON s.id=r.suite_id AND s.organization_id=r.organization_id AND s.workspace_id=r.workspace_id
  WHERE r.organization_id=? AND r.workspace_id=? AND r.id=?`;
/** Scoped latest-run header and bounded presentation, checked against the stored derivation. */
export function latestRunHeader(db: DatabaseSync, scope: WorkspaceScope, key: SuiteKey): SuiteLatestRun | null {
  if (key.latest_run_id === null) return null;
  const row = db.prepare(latestRunHeaderSql).get(scope.organizationId, scope.workspaceId, key.latest_run_id);
  if (row === undefined) throw new StorageError('unavailable');
  const parsed = validateApi('SuiteLatestRun', {
    suiteId: row.suite_id,
    runId: row.id,
    state: row.state,
    outcome: row.outcome,
    requestedAt: row.requested_at,
    suiteName: row.suite_name,
    ...latestRunPresentation(db, scope, row),
  });
  if (
    !parsed.ok ||
    parsed.value.suiteId !== key.id ||
    parsed.value.suiteName.trim() !== parsed.value.suiteName ||
    parsed.value.requestedAt !== key.latest_requested_at ||
    suiteGroupOf(parsed.value) !== publicGroup(key.latest_group)
  )
    throw new StorageError('unavailable');
  return parsed.value;
}
