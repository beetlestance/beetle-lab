import { join } from 'node:path';
import { validatePrimitive } from '@beetle/contracts';
import { ProvisionError } from '../types.js';
import { canonical, fields } from '../src/capture.js';
import { validOrigin } from '../src/origin-selector.js';
import { privateDirectory, readPrivate, writePrivate } from '../upgrade/files.js';

/**
 * Host-side record of every origin change, outside the installation root. A replayed
 * operation ID answers from its record and never writes again, so a stale replay cannot
 * overwrite a newer change. At most one operation is pending at a time.
 */
export interface OriginOperation {
  readonly operationId: string;
  readonly from: string;
  readonly to: string;
  readonly phase: 'pending' | 'committed';
}
export interface OriginRecords {
  readonly version: 1;
  readonly installationId: string;
  readonly operations: readonly OriginOperation[];
}
export const MAX_ORIGIN_OPERATIONS = 256;
const RECORDS_BYTES = 131_072;
const recordsPath = (directory: string) => join(directory, 'operations.json');
function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('recovery_required');
}
function captureOperation(value: unknown): OriginOperation {
  fields(value, ['operationId', 'from', 'to', 'phase']);
  valid(validatePrimitive('uuid', value.operationId).ok);
  valid(validOrigin(value.from) && validOrigin(value.to) && value.from !== value.to);
  valid(value.phase === 'pending' || value.phase === 'committed');
  return value as unknown as OriginOperation;
}
export function captureOriginRecords(value: unknown, installationId: string): OriginRecords {
  fields(value, ['version', 'installationId', 'operations']);
  valid(value.version === 1 && value.installationId === installationId);
  valid(Array.isArray(value.operations) && value.operations.length <= MAX_ORIGIN_OPERATIONS);
  const operations = value.operations.map(captureOperation);
  valid(new Set(operations.map((item) => item.operationId)).size === operations.length);
  // Only the newest operation may be pending.
  valid(operations.slice(0, -1).every((item) => item.phase === 'committed'));
  return { version: 1, installationId, operations };
}
export async function readOriginRecords(directory: string, installationId: string): Promise<OriginRecords> {
  await privateDirectory(directory, true);
  const bytes = await readPrivate(recordsPath(directory), RECORDS_BYTES);
  if (!bytes) return { version: 1, installationId, operations: [] };
  try {
    return captureOriginRecords(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), installationId);
  } catch (cause) {
    throw new ProvisionError('recovery_required', { cause });
  }
}
export async function writeOriginRecords(directory: string, records: OriginRecords): Promise<void> {
  const value = captureOriginRecords(JSON.parse(canonical(records)), records.installationId);
  await writePrivate(recordsPath(directory), Buffer.from(canonical(value)));
}
/** The newest operation when it is still pending. */
export function pendingOperation(records: OriginRecords): OriginOperation | undefined {
  const last = records.operations.at(-1);
  return last?.phase === 'pending' ? last : undefined;
}
/** For other operations' checks: reads the records without creating their directory. */
export async function originChangePending(directory: string, installationId: string): Promise<boolean> {
  const bytes = await readPrivate(recordsPath(directory), RECORDS_BYTES);
  if (!bytes) return false;
  try {
    const records = captureOriginRecords(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      installationId,
    );
    return pendingOperation(records) !== undefined;
  } catch (cause) {
    throw new ProvisionError('recovery_required', { cause });
  }
}
