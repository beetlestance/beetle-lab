import type { DatabaseSync } from 'node:sqlite';
import { foldRunSearchName, runSearchTerms, validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { captureNamespaceId } from '../namespace-rows.js';
import { sqlTextColumn } from '../sql-columns.js';
import { StorageError } from '../protocol.js';
import { capturePrefixKey, prefixKeyColumns } from './rows.js';
import type { PrefixKey } from './rows.js';
const budget = 256;

function currentNote(db: DatabaseSync, scope: WorkspaceScope, runId: string): string | null {
  const row = db
    .prepare(
      `SELECT ${sqlTextColumn('note', 4000, true)} FROM run_notes WHERE organization_id=? AND workspace_id=? AND run_id=?`,
    )
    .get(scope.organizationId, scope.workspaceId, runId);
  if (row === undefined || row.note === null) return null;
  if (!validateApi('RunNote', row.note).ok) throw new StorageError('unavailable');
  return row.note as string;
}
/**
 * Same budget as names: the first term whose complete posting is <=256 runs selects
 * candidates, then each current note is verified against the whole literal. Every
 * term over budget fails `search_too_broad`; nothing is returned partially.
 */
export function matchingNoteRuns(db: DatabaseSync, scope: WorkspaceScope, name: string): string[] {
  for (const term of runSearchTerms(name)) {
    const ids = db
      .prepare(
        `SELECT ${sqlTextColumn('run_id', 45, false, '', 'id')} FROM history_note_grams
      WHERE organization_id=? AND workspace_id=? AND term=? ORDER BY history_note_grams.run_id LIMIT ?`,
      )
      .all(scope.organizationId, scope.workspaceId, term, budget + 1)
      .map((row) => captureNamespaceId(row).id);
    if (ids.length > budget) continue;
    return ids.filter((id) => {
      const note = currentNote(db, scope, id);
      return note !== null && foldRunSearchName(note).includes(name);
    });
  }
  throw new StorageError('search_too_broad');
}
/** Primary-key reads of <=256 verified runs; filters and cursor apply after the bound. */
export function noteRunKeys(db: DatabaseSync, scope: WorkspaceScope, name: string): PrefixKey[] {
  return matchingNoteRuns(db, scope, name).map((id) => {
    const row = db
      .prepare(`SELECT ${prefixKeyColumns} FROM runs WHERE organization_id=? AND workspace_id=? AND id=?`)
      .get(scope.organizationId, scope.workspaceId, id);
    if (row === undefined) throw new StorageError('unavailable');
    return capturePrefixKey(row);
  });
}

/** Pinned selection can check its bounded rows directly, without global note postings. */
export function matchingPinnedNotes(
  db: DatabaseSync,
  scope: WorkspaceScope,
  name: string,
  pins: readonly PrefixKey[],
): PrefixKey[] {
  return pins.filter((row) => {
    const note = currentNote(db, scope, row.id);
    return note !== null && foldRunSearchName(note).includes(name);
  });
}
