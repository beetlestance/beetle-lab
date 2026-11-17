import type { DatabaseSync } from 'node:sqlite';
import { suiteGroupOf, validateApi } from '@beetle/contracts/api';
import type { SuiteLatestRun, WorkspaceScope } from '@beetle/contracts/api';
import { sqlTextColumn } from '../sql-columns.js';
import { StorageError } from '../protocol.js';
import { publicGroup } from './statements.js';
import type { SuiteKey } from './statements.js';

const latestRunColumns = [
  sqlTextColumn('id', 45),
  sqlTextColumn('suite_id', 45),
  sqlTextColumn('state', 64),
  sqlTextColumn('outcome', 64),
  sqlTextColumn('requested_at', 40),
].join(',');
/** Inline header of the stored latest Run: one primary-key read, checked against the stored derivation. */
export function latestRunHeader(db: DatabaseSync, scope: WorkspaceScope, key: SuiteKey): SuiteLatestRun | null {
  if (key.latest_run_id === null) return null;
  const row = db
    .prepare(`SELECT ${latestRunColumns} FROM runs WHERE organization_id=? AND workspace_id=? AND id=?`)
    .get(scope.organizationId, scope.workspaceId, key.latest_run_id);
  if (row === undefined) throw new StorageError('unavailable');
  const parsed = validateApi('SuiteLatestRun', {
    suiteId: row.suite_id,
    runId: row.id,
    state: row.state,
    outcome: row.outcome,
    requestedAt: row.requested_at,
  });
  if (
    !parsed.ok ||
    parsed.value.suiteId !== key.id ||
    parsed.value.requestedAt !== key.latest_requested_at ||
    suiteGroupOf(parsed.value) !== publicGroup(key.latest_group)
  )
    throw new StorageError('unavailable');
  return parsed.value;
}
