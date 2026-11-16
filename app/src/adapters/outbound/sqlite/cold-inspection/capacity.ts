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
function valid(condition: unknown): asserts condition { if (!condition) throw new StorageError('conflict'); }
export function readColdSettings(db: DatabaseSync, bootstrap: InstallationRecord): InstallationRecord {
  const store = new Settings(db, { installation: bootstrap, runtime: null });
  const current = store.chain({ kind: 'installation' }).installation;
  valid(validatePrimitive('uuid', current.id).ok && Number.isSafeInteger(current.version) && current.version > 0);
  valid(validateApi('InstallationValues', current.values).ok);
  return current;
}
/** Both startup leases and a cold terminal-work proof are required before opening writable metadata. */
export function applyColdMemoryChange(db: DatabaseSync, input: { expected: InstallationRecord;
  memoryBytes: number; operationId: string; ceilings: RuntimeCeilings }): 'changed' | 'unchanged' {
  valid(validatePrimitive('uuid', input.operationId).ok);
  valid(Number.isSafeInteger(input.memoryBytes) && input.memoryBytes > input.expected.values.perRunCeilings.memoryBytes);
  prepareColdMetadataChange(db);
  return transaction(db, () => {
    const current = readColdSettings(db, input.expected);
    const values = structuredClone(input.expected.values);
    values.perRunCeilings.memoryBytes = input.memoryBytes;
    values.runDefaults.budget.memoryBytes = input.memoryBytes;
    valid(current.id === input.expected.id);
    if (current.version === input.expected.version + 1 && canonical(current.values) === canonical(values)) return 'unchanged';
    valid(current.version === input.expected.version && canonical(current.values) === canonical(input.expected.values));
    const patch = { perRunCeilings: values.perRunCeilings, runDefaults: values.runDefaults };
    const request = { schemaVersion: 2 as const, scope: { kind: 'installation' as const }, requestId: input.operationId,
      expectedVersion: input.expected.version, patch };
    const command = { kind: 'patchSettings' as const, id: current.id, request,
      intentDigest: createHash('sha256').update(canonical(request)).digest('hex') };
    const store = new Settings(db, { installation: input.expected, runtime: null });
    store.changeOffline(command, input.ceilings);
    valid(canonical(store.chain({ kind: 'installation' }).installation.values) === canonical(values));
    return 'changed';
  });
}
