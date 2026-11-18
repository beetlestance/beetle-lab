import { join } from 'node:path';
import { validatePrimitive } from '@beetle/contracts';
import { ProvisionError } from '../types.js';
import { canonical, fields } from '../src/capture.js';
import type { ImagePins } from '../src/selection.js';
import type { BackupSeal } from './backup.js';
import { privateDirectory, readPrivate, stat, syncDirectory, upgradeNative, writePrivate } from './files.js';

export const phases = [
  'backing_up',
  'applying',
  'awaiting_activation',
  'activated',
  'rolling_back',
  'rolled_back',
] as const;
export type UpgradePhase = (typeof phases)[number];
export const steps = ['configuration', 'journal', 'metadata'] as const;
export type UpgradeStep = (typeof steps)[number];
export interface UpgradeIdentity {
  readonly pins: ImagePins;
  readonly metadataSchema: number;
  readonly journalSchema: number;
}
/** Durable host-side upgrade record; written before any installation change and after each step. */
export interface UpgradeReceipt {
  readonly version: 1;
  readonly operationId: string;
  readonly installationId: string;
  readonly phase: UpgradePhase;
  readonly from: UpgradeIdentity;
  readonly to: UpgradeIdentity;
  readonly backup: BackupSeal | null;
  readonly steps: readonly UpgradeStep[];
  readonly updatedAt: string;
}
const RECEIPT_BYTES = 65_536;
export const receiptPath = (directory: string) => join(directory, 'receipt.json');
function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('recovery_required');
}
function identity(value: unknown): void {
  fields(value, ['pins', 'metadataSchema', 'journalSchema']);
  fields(value.pins, ['agent', 'engines']);
  valid(typeof value.pins.agent === 'string' && Array.isArray(value.pins.engines));
  valid(Number.isSafeInteger(value.metadataSchema) && Number.isSafeInteger(value.journalSchema));
}
export function captureUpgradeReceipt(value: unknown): UpgradeReceipt {
  fields(value, ['version', 'operationId', 'installationId', 'phase', 'from', 'to', 'backup', 'steps', 'updatedAt']);
  valid(value.version === 1 && phases.includes(value.phase as UpgradePhase));
  valid(validatePrimitive('uuid', value.operationId).ok && validatePrimitive('uuid', value.installationId).ok);
  identity(value.from);
  identity(value.to);
  if (value.backup !== null) fields(value.backup, ['manifestDigest', 'entries', 'bytes']);
  valid(Array.isArray(value.steps) && value.steps.every((step) => steps.includes(step as UpgradeStep)));
  return value as unknown as UpgradeReceipt;
}
export async function readUpgradeReceipt(directory: string): Promise<UpgradeReceipt | undefined> {
  const bytes = await readPrivate(receiptPath(directory), RECEIPT_BYTES);
  if (!bytes) return undefined;
  try {
    return captureUpgradeReceipt(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (cause) {
    throw new ProvisionError('recovery_required', { cause });
  }
}
export async function writeUpgradeReceipt(
  directory: string,
  receipt: Omit<UpgradeReceipt, 'updatedAt'>,
): Promise<UpgradeReceipt> {
  const value = captureUpgradeReceipt({ ...receipt, updatedAt: new Date().toISOString() });
  await writePrivate(receiptPath(directory), Buffer.from(canonical(value)));
  return value;
}
export const terminal = (receipt: UpgradeReceipt | undefined): boolean =>
  receipt === undefined || receipt.phase === 'activated' || receipt.phase === 'rolled_back';
export const operationDirectory = (directory: string, operationId: string) => join(directory, operationId);
/** Moves a finished receipt beside its operation's backup so a new upgrade starts clean. */
export async function archiveUpgradeReceipt(directory: string, receipt: UpgradeReceipt): Promise<void> {
  valid(terminal(receipt));
  const target = operationDirectory(directory, receipt.operationId);
  await privateDirectory(target, true);
  valid(!(await stat(join(target, 'receipt.json'))));
  await upgradeNative.rename(receiptPath(directory), join(target, 'receipt.json'));
  await syncDirectory(directory);
  await syncDirectory(target);
}
