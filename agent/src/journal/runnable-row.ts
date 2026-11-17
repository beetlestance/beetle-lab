import { validatePrimitive } from '@beetle/contracts';
import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { storedRecord, storedInteger } from './row-values.js';
import { Failure } from './failure.js';
export interface RunnableRow {
  id: number;
  attempt_id: string;
  organization_id: string;
  workspace_id: string;
  generation: number;
}
export function runnableColumns(idAlias: 'a.' | 'r.' | 'q.'): string {
  // Raw INTEGER PRIMARY KEY preserves UNION index merging; range capture follows.
  return [
    idAlias+'id',
    sqlTextColumn('attempt_id', 45, false, 'a.'),
    sqlTextColumn('organization_id', 45, false, 'a.'),
    sqlTextColumn('workspace_id', 45, false, 'a.'),
    sqlIntegerColumn('generation', false, 'a.'),
  ].join(',');
}
function uuid(input: unknown): string {
  const parsed = validatePrimitive('uuid', input);
  if (!parsed.ok) throw new Failure('unavailable');
  return parsed.value;
}
export function captureRunnableRows(
  input: readonly unknown[],
  after: number,
  through = Number.MAX_SAFE_INTEGER,
): RunnableRow[] {
  let previous = after;
  return input.map((value) => {
    const row = storedRecord(value);
    const id = storedInteger(row.id, previous + 1, through);
    previous = id;
    return {
      id,
      attempt_id: uuid(row.attempt_id),
      organization_id: uuid(row.organization_id),
      workspace_id: uuid(row.workspace_id),
      generation: storedInteger(row.generation, 1,1),
    };
  });
}
