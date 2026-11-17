import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { validateApi } from '@beetle/contracts/api';
import type { Suite, SuiteRevision, SuiteRevisionSummary, WorkspaceScope } from '@beetle/contracts/api';
import type { SuiteKey } from '../../../ports/suites.js';
import { sameScope } from '../../../domain/namespaces/index.js';
import { inputManifest } from '../../../domain/suites/index.js';
import { digestMutationIntent } from '../../../application/namespaces/index.js';
import { k6ConfigSchema } from '../execution-profiles/index.js';
import { sha256 } from './input-values.js';
import { StorageError } from './protocol.js';
function columns(fields: readonly [string, number, boolean][]): string {
  return fields.map(([name, maximum, nullable]) => sqlTextColumn(name, maximum, nullable)).join(',');
}
const identityColumns: readonly [string, number, boolean][] = [
  ['id', 45, false],
  ['organization_id', 45, false],
  ['workspace_id', 45, false],
];
export const suiteColumns =
  columns([...identityColumns, ['folder_id', 45, false], ['name', 512, false], ['current_revision_id', 45, true]]) +
  ',' +
  sqlIntegerColumn('version');
/** Retained Runs per revision: one primary-key probe of the trigger-maintained count. */
const runCountColumn = `(SELECT CASE WHEN typeof(c.run_count)='integer' AND c.run_count BETWEEN 0 AND 9007199254740991
 THEN c.run_count END FROM suite_revision_run_counts c WHERE c.revision_id=suite_revisions.id) AS run_count`;
export const revisionSummaryColumns =
  columns([...identityColumns, ['suite_id', 45, false], ['digest', 64, false]]) +
  ',' +
  sqlIntegerColumn('ordinal') +
  ',' +
  runCountColumn;
const contentColumns = columns([
  ['config_json', 2097152, false],
  ['input_manifest_json', 65536, false],
]);
export const revisionColumns = revisionSummaryColumns + ',' + contentColumns;
const uncountedColumns =
  columns([...identityColumns, ['suite_id', 45, false], ['digest', 64, false]]) + ',' + sqlIntegerColumn('ordinal');
/** `stored`: public reads. `new`: inserted in this transaction, so no Run references it yet.
 * `omit`: internal content reads (Run/export intake) that never return the revision. */
export type RevisionRunCount = 'stored' | 'new' | 'omit';
export function revisionProjection(count: RevisionRunCount): string {
  if (count === 'stored') return revisionColumns;
  return `${uncountedColumns},${count === 'new' ? '0 AS run_count,' : ''}${contentColumns}`;
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  return input as Record<string, unknown>;
}
function owner(row: Record<string, unknown>): unknown {
  return { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id };
}
export function captureSuiteRow(input: unknown, key: SuiteKey): Suite {
  const row = record(input);
  const parsed = validateApi('Suite', {
    id: row.id,
    scope: owner(row),
    name: row.name,
    folderId: row.folder_id,
    version: row.version,
    currentRevisionId: row.current_revision_id,
  });
  if (!parsed.ok || !sameScope(parsed.value.scope, key.scope) || parsed.value.id !== key.id.toLowerCase())
    throw new StorageError('unavailable');
  return parsed.value;
}
export function captureRevisionSummary(input: unknown, scope: WorkspaceScope, suiteId?: string): SuiteRevisionSummary {
  const row = record(input);
  const parsed = validateApi('SuiteRevisionSummary', {
    id: row.id,
    scope: owner(row),
    suiteId: row.suite_id,
    ordinal: row.ordinal,
    digest: row.digest,
    engineId: 'k6',
    configVersion: 1,
    preflightStatus: 'passed',
    ...(row.run_count === undefined ? {} : { runCount: row.run_count }),
  });
  if (!parsed.ok || !sameScope(parsed.value.scope, scope)) throw new StorageError('unavailable');
  if (suiteId !== undefined && parsed.value.suiteId !== suiteId.toLowerCase()) throw new StorageError('unavailable');
  return parsed.value;
}
function json(input: unknown, maximum: number): unknown {
  if (typeof input !== 'string' || Buffer.byteLength(input) > maximum) throw new StorageError('unavailable');
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new StorageError('unavailable');
  }
}
function revisionContent(value: SuiteRevision): void {
  try {
    if (!k6ConfigSchema.validate(value.config)) throw new StorageError('unavailable');
    const expected = inputManifest(value.config);
    if (digestMutationIntent(expected, sha256) !== digestMutationIntent(value.inputManifest, sha256))
      throw new StorageError('unavailable');
    const digest = digestMutationIntent(
      { engineId: 'k6', configVersion: 1, config: value.config, inputManifest: value.inputManifest },
      sha256,
    );
    if (digest !== value.digest) throw new StorageError('unavailable');
  } catch {
    throw new StorageError('unavailable');
  }
}
export function captureRevisionRow(input: unknown, key: SuiteKey): SuiteRevision {
  const row = record(input);
  const summary = captureRevisionSummary(row, key.scope);
  if (summary.id !== key.id.toLowerCase()) throw new StorageError('unavailable');
  const parsed = validateApi('SuiteRevision', {
    ...summary,
    config: json(row.config_json, 2097152),
    inputManifest: json(row.input_manifest_json, 65536),
  });
  if (!parsed.ok) throw new StorageError('unavailable');
  revisionContent(parsed.value);
  return parsed.value;
}
