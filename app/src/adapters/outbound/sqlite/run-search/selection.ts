import type { DatabaseSync } from 'node:sqlite';
import type { RunList } from '../../../../ports/runs.js';
import { StorageError } from '../protocol.js';
import { pinnedRunsSql } from '../run-pins/index.js';
import { RUN_PIN_LIMIT } from '../migration033.js';
import { capturePrefixKey, prefixKeyColumns } from './rows.js';
import type { PrefixKey } from './rows.js';
import { matchingSuites, workspaceNameMatches } from './names.js';
import { noteRunKeys, matchingPinnedNotes } from './notes.js';

export interface HistorySelection {
  /** Null means names did not narrow the workspace. */
  suites: readonly string[] | null;
  notes: readonly PrefixKey[];
  prefix: readonly PrefixKey[] | undefined;
  pinned: readonly PrefixKey[] | undefined;
  countNotes?: readonly PrefixKey[];
  countsUnavailable?: 'search_too_broad';
}
/** Shared complete bounded candidates for both page keys and optional counts. */
export function historySelection(db: DatabaseSync, input: RunList): HistorySelection {
  const narrowed = input.name !== undefined && !workspaceNameMatches(db, input.scope, input.name);
  const pins = input.pinned === true || input.includeCounts === true ? pinnedRows(db, input) : undefined;
  const selection: HistorySelection = {
    suites: narrowed ? matchingSuites(db, input.scope, input.name!) : null,
    notes: narrowed ? selectedNotes(db, input, pins) : [],
    prefix: input.pinned !== true && input.runIdPrefix !== undefined ? prefixRows(db, input) : undefined,
    pinned: pins,
  };
  if (input.pinned === true && input.includeCounts === true) captureCountContext(db, input, selection, narrowed);
  return selection;
}
function selectedNotes(db: DatabaseSync, input: RunList, pins: readonly PrefixKey[] | undefined): PrefixKey[] {
  return input.pinned === true
    ? matchingPinnedNotes(db, input.scope, input.name!, pins ?? [])
    : noteRunKeys(db, input.scope, input.name!);
}
/** Optional complete context discovery never changes a successful bounded pin selection. */
function captureCountContext(db: DatabaseSync, input: RunList, selection: HistorySelection, narrowed: boolean): void {
  try {
    if (input.runIdPrefix !== undefined) selection.prefix = prefixRows(db, input);
    if (narrowed) selection.countNotes = noteRunKeys(db, input.scope, input.name!);
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== 'search_too_broad') throw error;
    selection.countsUnavailable = 'search_too_broad';
  }
}

function prefixRows(db: DatabaseSync, input: RunList): PrefixKey[] {
  const prefix = input.runIdPrefix!;
  const rows = db
    .prepare(
      `SELECT ${prefixKeyColumns} FROM runs INDEXED BY runs_page
    WHERE organization_id=? AND workspace_id=? AND id>=? AND id<? ORDER BY runs.id LIMIT 257`,
    )
    .all(input.scope.organizationId, input.scope.workspaceId, prefix, prefix + '~')
    .map(capturePrefixKey);
  if (rows.length > 256) throw new StorageError('search_too_broad');
  return rows;
}
function pinnedRows(db: DatabaseSync, input: RunList): PrefixKey[] {
  const rows = db
    .prepare(
      `SELECT ${prefixKeyColumns} FROM runs
    WHERE organization_id=? AND workspace_id=? AND id IN (${pinnedRunsSql}) LIMIT ${RUN_PIN_LIMIT + 1}`,
    )
    .all(input.scope.organizationId, input.scope.workspaceId, input.scope.organizationId, input.scope.workspaceId)
    .map(capturePrefixKey);
  if (rows.length > RUN_PIN_LIMIT) throw new StorageError('unavailable');
  return rows;
}
/** Context filters only: state/outcome/pin chips and cursor are deliberately excluded. */
export function inHistoryContext(row: PrefixKey, input: RunList, selection: HistorySelection): boolean {
  return (
    (input.suiteId === undefined || row.suite_id === input.suiteId) &&
    (input.runIdPrefix === undefined || row.id.startsWith(input.runIdPrefix)) &&
    (selection.suites === null ||
      selection.suites.includes(row.suite_id) ||
      selection.notes.some((note) => note.id === row.id))
  );
}
