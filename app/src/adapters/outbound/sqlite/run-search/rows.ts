import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { foldedName } from '../../../../domain/namespaces/index.js';
import { captureNamespaceId, namespaceIdColumn } from '../namespace-rows.js';
import { sqlTextColumn, sqlIntegerColumn } from '../sql-columns.js';
import { StorageError } from '../protocol.js';
export interface HistoryKey {
  id: string;
  requested_at: string;
}
export interface PrefixKey extends HistoryKey {
  state: Run['state'];
  outcome: Run['outcome'];
  suite_id: string;
}
export interface SearchCandidate {
  kind: 'suite' | 'folder';
  entity_id: string;
}
export interface SearchDocument {
  id: string;
  name: string;
  folded_name: string;
}
export interface SearchProgress {
  folder_after: string;
  suite_after: string;
  folders_done: 0 | 1;
  suites_done: 0 | 1;
}
export const historyKeyColumns = [namespaceIdColumn, sqlTextColumn('requested_at', 40)].join(',');
export const prefixKeyColumns = [
  historyKeyColumns,
  sqlTextColumn('state', 64),
  sqlTextColumn('outcome', 64),
  sqlTextColumn('suite_id', 45),
].join(',');
export const documentColumns = [
  namespaceIdColumn,
  sqlTextColumn('name', 512),
  sqlTextColumn('folded_name', 16384),
].join(',');
export const progressColumns = [
  sqlTextColumn('folder_after', 45),
  sqlTextColumn('suite_after', 45),
  sqlIntegerColumn('folders_done'),
  sqlIntegerColumn('suites_done'),
].join(',');
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  return input as Record<string, unknown>;
}
export function captureHistoryKey(input: unknown): HistoryKey {
  const row = record(input);
  const id = captureNamespaceId(row).id;
  const time = validateApi('RunTimestamp', row.requested_at);
  if (!time.ok) throw new StorageError('unavailable');
  return { id, requested_at: time.value };
}
export function capturePrefixKey(input: unknown): PrefixKey {
  const row = record(input);
  const key = captureHistoryKey(row);
  if (typeof row.state !== 'string' || typeof row.outcome !== 'string') throw new StorageError('unavailable');
  const parsed = validateApi('RunListQuery', { limit: 1, state: row.state, outcome: row.outcome });
  if (!parsed.ok || parsed.value.state === undefined || parsed.value.outcome === undefined)
    throw new StorageError('unavailable');
  return {
    ...key,
    state: parsed.value.state,
    outcome: parsed.value.outcome,
    suite_id: captureNamespaceId({ id: row.suite_id }).id,
  };
}
export function captureSearchCandidate(input: unknown): SearchCandidate {
  const row = record(input);
  if (row.kind !== 'suite' && row.kind !== 'folder') throw new StorageError('unavailable');
  return { kind: row.kind, entity_id: captureNamespaceId({ id: row.entity_id }).id };
}
export function captureSearchName(input: unknown): string {
  const parsed = validateApi('Name', input);
  if (!parsed.ok) throw new StorageError('unavailable');
  return parsed.value;
}
export function captureSearchDocument(input: unknown): SearchDocument {
  const row = record(input);
  const id = captureNamespaceId(row).id;
  const name = captureSearchName(row.name);
  if (typeof row.folded_name !== 'string' || Buffer.byteLength(row.folded_name) > 16384)
    throw new StorageError('unavailable');
  try {
    if (foldedName(name) !== row.folded_name) throw new StorageError('unavailable');
  } catch {
    throw new StorageError('unavailable');
  }
  return { id, name, folded_name: row.folded_name };
}
function cursor(input: unknown): string {
  return input === '' ? '' : captureNamespaceId({ id: input }).id;
}
function flag(input: unknown): 0 | 1 {
  if (input !== 0 && input !== 1) throw new StorageError('unavailable');
  return input;
}
export function captureSearchProgress(input: unknown): SearchProgress {
  const row = record(input);
  return {
    folder_after: cursor(row.folder_after),
    suite_after: cursor(row.suite_after),
    folders_done: flag(row.folders_done),
    suites_done: flag(row.suites_done),
  };
}
