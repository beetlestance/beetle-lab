import { join } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import {
  captureGeneration,
  captureCapacityIncrease,
  INSTALLATION_RECEIPT_BYTES,
} from '@beetle/contracts/installation-generation';
import type { ConfigurationGeneration, CapacityIncrease } from '@beetle/contracts/installation-generation';
import type { InstallationRecord } from '../../../app/src/domain/settings/index.js';
import { validatePrimitive } from '@beetle/contracts';
import { PrivateFiles } from '../src/files.js';
import { captureReceipt, parse, jsonBytes } from '../src/receipt.js';
import type { Receipt } from '../src/receipt.js';
import { configurationStatePath } from '../src/configuration.js';
import { canonical, digest, fields, requireInput } from '../src/capture.js';
import type { Captured } from '../src/capture.js';
export interface PendingCapacityChange {
  readonly operationId: string;
  readonly increase: CapacityIncrease;
  readonly expectedSettings: InstallationRecord;
  readonly generation: ConfigurationGeneration;
}
export interface State {
  readonly receipt: Receipt;
  readonly pending?: PendingCapacityChange;
  readonly absent: boolean;
}
export async function filesFor(c: Captured): Promise<PrivateFiles> {
  const files = new PrivateFiles(c);
  try {
    await files.pin(c.request.root);
    await files.pin(join(c.request.root, 'config'));
    return files;
  } catch (error) {
    await files.close();
    throw error;
  }
}
export async function readState(c: Captured, files: PrivateFiles): Promise<State> {
  const baseline = captureReceipt(
    parse(await files.read(join(c.request.root, 'installation.json'), INSTALLATION_RECEIPT_BYTES)),
    c,
  );
  let input: unknown;
  try {
    input = parse(await files.read(configurationStatePath(c.request.root), INSTALLATION_RECEIPT_BYTES));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { receipt: baseline, absent: true };
    throw error;
  }
  requireInput(input !== null && typeof input === 'object' && !Array.isArray(input));
  const raw = input as Record<string, unknown>;
  const { pending, ...envelope } = raw;
  const receipt = captureReceipt(pending === undefined ? envelope : { ...envelope, phase: 'ready' }, c);
  for (const key of ['installationId', 'operationId', 'requestDigest', 'authority', 'configDigests'] as const) {
    requireInput(canonical(receipt[key]) === canonical(baseline[key]));
  }
  if (pending === undefined) return { receipt, absent: false };
  requireInput(raw.phase === 'reconfiguring');
  return { receipt, absent: false, pending: capturePending(pending, receipt) };
}
function capturePending(pending: unknown, receipt: Receipt): PendingCapacityChange {
  requireInput(pending !== null && typeof pending === 'object' && !Array.isArray(pending));
  const legacy = Object.hasOwn(pending, 'memoryBytes');
  fields(pending, ['operationId', legacy ? 'memoryBytes' : 'increase', 'expectedSettings', 'generation']);
  const increase = captureCapacityIncrease(
    legacy ? { resource: 'memory', bytes: pending.memoryBytes } : pending.increase,
  );
  requireInput(validatePrimitive('uuid', pending.operationId).ok);
  const expectedSettings = captureExpectedSettings(pending.expectedSettings, receipt.installationId);
  const generation = captureGeneration(pending.generation, receipt.installationId, receipt.requestDigest, digest);
  requireInput(generation.operationId === pending.operationId);
  if (generation.increase) requireInput(canonical(generation.increase) === canonical(increase));
  else requireInput(increase.resource === 'memory');
  return {
    operationId: pending.operationId,
    increase,
    expectedSettings,
    generation,
  } as unknown as PendingCapacityChange;
}
export async function publishState(
  c: Captured,
  expected: State,
  pending: PendingCapacityChange,
  commit: boolean,
): Promise<void> {
  const files = await filesFor(c);
  try {
    const actual = await readState(c, files);
    requireInput(canonical(actual) === canonical(expected));
    const value = commit
      ? { ...expected.receipt, generation: pending.generation }
      : { ...expected.receipt, phase: 'reconfiguring', pending };
    requireInput(Buffer.byteLength(canonical(value)) <= INSTALLATION_RECEIPT_BYTES);
    if (actual.absent) await files.write(configurationStatePath(c.request.root), jsonBytes(actual.receipt));
    // The exact caller-supplied operation ID permits recovery of a pre-rename temporary.
    await files.ready(
      value,
      `${pending.operationId}-${commit ? 'commit' : 'prepare'}`,
      configurationStatePath(c.request.root),
      true,
    );
  } finally {
    await files.close();
  }
}

function captureExpectedSettings(input: unknown, installationId: string): InstallationRecord {
  fields(input, ['id', 'version', 'schemaVersion', 'scope', 'values']);
  requireInput(input.id === installationId && input.schemaVersion === 2);
  requireInput(Number.isSafeInteger(input.version) && Number(input.version) > 0);
  requireInput(validateApi('InstallationScope', input.scope).ok && validateApi('InstallationValues', input.values).ok);
  return input as unknown as InstallationRecord;
}
