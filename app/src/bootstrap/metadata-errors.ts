import type { ApiError } from '@beetle/contracts/api';
import { StorageError } from '../adapters/outbound/sqlite/index.js';
import type { ErrorCode } from '../adapters/outbound/sqlite/index.js';

const codes = {
  invalid_input: 'malformed_request', invalid_value: 'invalid_value', not_found: 'not_found', conflict: 'conflict',
  search_too_broad: 'search_too_broad', search_indexing: 'search_indexing',
  capacity_unavailable: 'capacity_unavailable', queue_full: 'storage_unavailable', closed: 'storage_unavailable',
  read_only: 'forbidden', unavailable: 'storage_unavailable', owned: 'storage_unavailable', schema_newer: 'storage_unavailable',
} as const satisfies Record<ErrorCode, ApiError['code']>;

/** Bootstrap bridges concrete storage errors; HTTP/use cases never import SQLite. */
export function classifyMetadataError(error: unknown): ApiError['code'] | undefined {
  return error instanceof StorageError ? codes[error.code] : undefined;
}
