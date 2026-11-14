import type { DatabaseSync } from 'node:sqlite';
import type { Operation } from './protocol.js';
import { StorageError } from './protocol.js';
const historical = new WeakSet<DatabaseSync>();
export function markHistorical(db: DatabaseSync): void {historical.add(db);}
export function isHistorical(db: DatabaseSync): boolean {return historical.has(db);}
const reads = new Set<Operation['kind']>(['close', 'get', 'list', 'getSettings', 'getSettingsIdentity',
  'getOrganizationOverview', 'getWorkspaceOverview', 'getRun', 'listRuns', 'getRunResult', 'getRunEvents', 'getRunExecution',
  'listRunArtifacts', 'getRunArtifact', 'getSuite', 'getRevision', 'listSuites', 'listRevisions',
  'getInput', 'listInputs', 'inputStorage', 'getExport', 'listExports']);
/** Deny by default before any private worker mutation or original/replay lookup. */
export function assertHistoricalRead(db: DatabaseSync, operation: Operation): void {
  const exportRead = operation.kind === 'exportOutput' && operation.operation.method === 'published';
  if (historical.has(db) && !reads.has(operation.kind) && !exportRead) throw new StorageError('read_only');
}

export function validateHistoricalMode(readOnly: unknown, runtime: unknown): void {
  if (readOnly !== undefined && readOnly !== true) throw new StorageError('invalid_input');
  if (readOnly && runtime !== null) throw new StorageError('invalid_input');
}
