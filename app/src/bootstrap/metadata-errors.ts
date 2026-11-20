import type { ApiError } from '@beetle/contracts/api';
import { StorageError } from '../adapters/outbound/sqlite/index.js';
import type { ErrorCode } from '../adapters/outbound/sqlite/index.js';

const codes = {
  invalid_input: 'malformed_request',
  invalid_value: 'invalid_value',
  not_found: 'not_found',
  conflict: 'conflict',
  search_too_broad: 'search_too_broad',
  search_indexing: 'search_indexing',
  capacity_unavailable: 'capacity_unavailable',
  queue_full: 'storage_unavailable',
  closed: 'storage_unavailable',
  read_only: 'forbidden',
  unavailable: 'storage_unavailable',
  owned: 'storage_unavailable',
  schema_newer: 'storage_unavailable',
  protected_dependency: 'protected_dependency',
  pin_limit: 'conflict',
  run_active: 'conflict',
  run_pinned: 'protected_dependency',
  cleanup_in_progress: 'conflict',
  folder_name_conflict: 'conflict',
  organization_slug_conflict: 'conflict',
  suite_name_conflict: 'conflict',
  folder_depth: 'invalid_value',
} as const satisfies Record<ErrorCode, ApiError['code']>;
const reasons = {
  pin_limit: 'pin_limit',
  run_active: 'active',
  run_pinned: 'pinned',
  cleanup_in_progress: 'cleanup_in_progress',
} as const satisfies Partial<Record<ErrorCode, NonNullable<ApiError['reason']>>>;

/** Bootstrap bridges concrete storage errors; HTTP/use cases never import SQLite. */
export function classifyMetadataError(error: unknown): ApiError['code'] | undefined {
  return error instanceof StorageError ? codes[error.code] : undefined;
}

/** Fixed protection reason for pin and removal refusals. */
export function explainMetadataError(error: unknown): NonNullable<ApiError['reason']> | undefined {
  if (!(error instanceof StorageError) || !Object.hasOwn(reasons, error.code)) return undefined;
  return reasons[error.code as keyof typeof reasons];
}

/** Fixed field categories; no database message or submitted value crosses HTTP. */
export function metadataFieldIssue(error: unknown): FieldIssue | undefined {
  if (!(error instanceof StorageError)) return undefined;
  return (fieldIssues as readonly string[]).includes(error.code) ? (error.code as FieldIssue) : undefined;
}
const fieldIssues = [
  'folder_name_conflict',
  'folder_depth',
  'suite_name_conflict',
  'organization_slug_conflict',
] as const;
type FieldIssue = (typeof fieldIssues)[number];
