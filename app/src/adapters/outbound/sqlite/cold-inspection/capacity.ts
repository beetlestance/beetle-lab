import { prepareColdMetadataChange } from '../schema.js';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { encodeCanonicalJson, validatePrimitive } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { InstallationRecord, RuntimeCeilings } from '../../../../domain/settings/index.js';
import { Settings } from '../settings.js';
import { transaction } from '../transaction.js';
import { StorageError } from '../protocol.js';
const canonical = (value: unknown) => encodeCanonicalJson(value, 32768);
function valid(condition: unknown): asserts condition {
  if (!condition) throw new StorageError('conflict');
}
export function readColdSettings(db: DatabaseSync, bootstrap: InstallationRecord): InstallationRecord {
  const store = new Settings(db, { installation: bootstrap, runtime: null });
  const current = store.chain({ kind: 'installation' }).installation;
  valid(validatePrimitive('uuid', current.id).ok && Number.isSafeInteger(current.version) && current.version > 0);
  valid(validateApi('InstallationValues', current.values).ok);
  return current;
}
/** Both startup leases and a cold terminal-work proof are required before opening writable metadata. */
export function applyColdMemoryChange(
  db: DatabaseSync,
  input: { expected: InstallationRecord; memoryBytes: number; operationId: string; ceilings: RuntimeCeilings },
): 'changed' | 'unchanged' {
  valid(
    Number.isSafeInteger(input.memoryBytes) && input.memoryBytes > input.expected.values.perRunCeilings.memoryBytes,
  );
  const values = structuredClone(input.expected.values);
  values.perRunCeilings.memoryBytes = input.memoryBytes;
  values.runDefaults.budget.memoryBytes = input.memoryBytes;
  return applyChange(db, {
    ...input,
    values,
    patch: { perRunCeilings: values.perRunCeilings, runDefaults: values.runDefaults },
  });
}
/** Caller owns the same offline exclusion; this never changes the storage allocation. */
export function applyColdOutputPoolChange(
  db: DatabaseSync,
  input: { expected: InstallationRecord; outputBytes: number; operationId: string; ceilings: RuntimeCeilings },
): 'changed' | 'unchanged' {
  valid(Number.isSafeInteger(input.outputBytes) && input.outputBytes > input.expected.values.pool.outputBytes);
  const values = structuredClone(input.expected.values);
  values.pool.outputBytes = input.outputBytes;
  return applyChange(db, { ...input, values, patch: { pool: values.pool } });
}
type Values = InstallationRecord['values'];
interface PreparedChange {
  expected: InstallationRecord;
  operationId: string;
  ceilings: RuntimeCeilings;
  values: Values;
  patch: Pick<Values, 'pool'> | Pick<Values, 'perRunCeilings' | 'runDefaults'>;
}
function applyChange(db: DatabaseSync, input: PreparedChange): 'changed' | 'unchanged' {
  valid(validatePrimitive('uuid', input.operationId).ok);
  valid(Number.isSafeInteger(input.expected.version + 1));
  prepareColdMetadataChange(db);
  return transaction(db, () => {
    const current = readColdSettings(db, input.expected);
    valid(current.id === input.expected.id);
    if (current.version === input.expected.version + 1 && canonical(current.values) === canonical(input.values))
      return 'unchanged';
    valid(current.version === input.expected.version && canonical(current.values) === canonical(input.expected.values));
    const request = {
      schemaVersion: 2 as const,
      scope: { kind: 'installation' as const },
      requestId: input.operationId,
      expectedVersion: input.expected.version,
      patch: input.patch,
    };
    const command = {
      kind: 'patchSettings' as const,
      id: current.id,
      request,
      intentDigest: createHash('sha256').update(canonical(request)).digest('hex'),
    };
    const store = new Settings(db, { installation: input.expected, runtime: null });
    store.changeOffline(command, input.ceilings);
    valid(canonical(store.chain({ kind: 'installation' }).installation.values) === canonical(input.values));
    return 'changed';
  });
}
