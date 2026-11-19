import type { DatabaseSync } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { sqlIntegerColumn, sqlTextColumn } from './sql-columns.js';
import { StorageError } from './protocol.js';

export interface RunAnnotations {
  note: string | null;
  noteVersion: number;
  noteUpdatedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
type Owned = Pick<Run, 'id' | 'scope' | 'activeAttemptId'>;
const runtimeKinds = "json_extract(e.canonical_json,'$.kind') IN ('runtime.started','runtime.exited')";

function unavailable(condition: boolean): asserts condition {
  if (!condition) throw new StorageError('unavailable');
}
/** Version 0 means no note was ever written; a cleared note keeps its version. */
export function readRunNote(
  db: DatabaseSync,
  run: Owned,
): Pick<RunAnnotations, 'note' | 'noteVersion' | 'noteUpdatedAt'> {
  const row = db
    .prepare(
      `SELECT ${sqlTextColumn('note', 4000, true)},${sqlIntegerColumn('version')},${sqlTextColumn('updated_at', 64, true)} FROM run_notes
      WHERE run_id=? AND organization_id=? AND workspace_id=?`,
    )
    .get(run.id, run.scope.organizationId, run.scope.workspaceId);
  if (row === undefined) return { note: null, noteVersion: 0, noteUpdatedAt: null };
  unavailable(typeof row.version === 'number' && row.version >= 1);
  unavailable(row.note === null || validateApi('RunNote', row.note).ok);
  return {
    note: row.note as string | null,
    noteVersion: row.version,
    noteUpdatedAt: row.updated_at === null ? null : observed(row.updated_at),
  };
}
function observed(input: unknown): string {
  const parsed = validateApi('RunTimestamp', input);
  unavailable(parsed.ok);
  return parsed.value;
}
/**
 * Runtime start and exit as observed by the agent on the active attempt's durable
 * event prefix. The partial index holds only these two kinds, so the read touches
 * at most four rows; missing or unretained events stay null, never estimated.
 */
export function readRunTimes(db: DatabaseSync, run: Owned): Pick<RunAnnotations, 'startedAt' | 'finishedAt'> {
  const rows = db
    .prepare(
      `SELECT e.seq AS seq,json_extract(e.canonical_json,'$.kind') AS kind,
      CASE WHEN typeof(json_extract(e.canonical_json,'$.observedAt'))='text'
        AND length(json_extract(e.canonical_json,'$.observedAt'))<=64
        THEN json_extract(e.canonical_json,'$.observedAt') END AS observed_at
      FROM run_events e INDEXED BY run_events_runtime
      JOIN event_cursors c ON c.attempt_id=e.attempt_id AND c.generation=e.generation
      WHERE e.attempt_id=? AND e.generation=1 AND ${runtimeKinds} AND c.run_id=? AND c.organization_id=?
        AND c.workspace_id=? AND e.seq<=c.durable_through ORDER BY e.seq LIMIT 4`,
    )
    .all(run.activeAttemptId, run.id, run.scope.organizationId, run.scope.workspaceId);
  const started = rows.find((row) => row.kind === 'runtime.started');
  const exited = rows.find(
    (row) => row.kind === 'runtime.exited' && (started === undefined || Number(row.seq) > Number(started.seq)),
  );
  return {
    startedAt: started === undefined ? null : observed(started.observed_at),
    finishedAt: exited === undefined ? null : observed(exited.observed_at),
  };
}
export function readRunAnnotations(db: DatabaseSync, run: Owned): RunAnnotations {
  return { ...readRunNote(db, run), ...readRunTimes(db, run) };
}
