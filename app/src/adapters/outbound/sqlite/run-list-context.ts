import type { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { Run, RunListContext, WorkspaceScope } from '@beetle/contracts/api';
import { sqlIntegerColumn, sqlTextColumn } from './sql-columns.js';
import { StorageError } from './protocol.js';

/** One <=100-row scalar join under the history read transaction; no config JSON. */
export function readRunListContexts(db: DatabaseSync, scope: WorkspaceScope, runs: readonly Run[]): RunListContext[] {
  if (runs.length === 0) return [];
  if (runs.length > 100) throw new StorageError('invalid_input');
  const placeholders = runs.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT
    ${sqlTextColumn('id', 45, false, 'r.', 'run_id')},
    ${sqlTextColumn('suite_id', 45, false, 'r.')},
    ${sqlTextColumn('revision_id', 45, false, 'r.')},
    ${sqlTextColumn('name', 512, false, 's.', 'suite_name')},
    ${sqlIntegerColumn('ordinal', false, 'v.', 'revision_ordinal')},
    ${sqlTextColumn('digest', 64, false, 'v.')}
    FROM runs r JOIN suites s ON s.id=r.suite_id AND s.organization_id=r.organization_id AND s.workspace_id=r.workspace_id
    JOIN suite_revisions v ON v.id=r.revision_id AND v.suite_id=r.suite_id
      AND v.organization_id=r.organization_id AND v.workspace_id=r.workspace_id
    WHERE r.organization_id=? AND r.workspace_id=? AND r.id IN (${placeholders})`,
    )
    .all(scope.organizationId, scope.workspaceId, ...runs.map((run) => run.id));
  const captured = rows.map((row) => capture(row));
  const indexed = new Map(captured.map((row) => [row.context.runId.toLowerCase(), row]));
  if (indexed.size !== runs.length) throw new StorageError('unavailable');
  return runs.map((run) => {
    const row = indexed.get(run.id.toLowerCase());
    if (
      !row ||
      row.context.suiteId !== run.suiteId ||
      row.context.revisionId !== run.revisionId ||
      row.digest !== run.revisionDigest
    )
      throw new StorageError('unavailable');
    return row.context;
  });
}

function capture(row: Record<string, unknown>): { context: RunListContext; digest: string } {
  const parsed = validateApi('RunListContext', {
    runId: row.run_id,
    suiteId: row.suite_id,
    revisionId: row.revision_id,
    suiteName: row.suite_name,
    revisionOrdinal: row.revision_ordinal,
  });
  if (!parsed.ok || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest))
    throw new StorageError('unavailable');
  return { context: parsed.value, digest: row.digest };
}
