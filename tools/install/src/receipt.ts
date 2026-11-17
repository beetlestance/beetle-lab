import { captureGeneration, INSTALLATION_RECEIPT_BYTES } from '@beetle/contracts/installation-generation';
import type { ConfigurationGeneration } from '@beetle/contracts/installation-generation';
import { validatePrimitive } from '@beetle/contracts';
import { ProvisionError } from '../types.js';
import { canonical, digest, fields } from './capture.js';
import type { Captured } from './capture.js';
import type { PrivateFiles } from './files.js';
import { configNames, configurationStatePath } from './configuration.js';
import { join } from 'node:path';

export interface Receipt {
  version: 1;
  operationId: string;
  installationId: string;
  requestDigest: string;
  phase: 'initializing' | 'ready';
  authority: string | null;
  configDigests: Record<string, string>;
  generation?: ConfigurationGeneration;
}
export const jsonBytes = (value: unknown): Uint8Array => Buffer.from(canonical(value));
export function parse(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}
function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('recovery_required');
}
export function captureReceipt(value: unknown, c: Captured): Receipt {
  fields(value, [
    'version',
    'operationId',
    'installationId',
    'requestDigest',
    'phase',
    'authority',
    'configDigests',
    ...(value !== null && typeof value === 'object' && Object.hasOwn(value, 'generation') ? ['generation'] : []),
  ]);
  valid(value.version === 1 && value.phase === 'ready');
  valid(
    validatePrimitive('uuid', value.operationId).ok &&
      validatePrimitive('uuid', value.installationId).ok &&
      validatePrimitive('uuid', value.authority).ok,
  );
  valid(value.requestDigest === c.requestDigest);
  fields(value.configDigests, configNames);
  for (const hash of Object.values(value.configDigests))
    valid(typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash));
  if (Object.hasOwn(value, 'generation'))
    captureGeneration(value.generation, String(value.installationId), c.requestDigest, digest);
  return value as unknown as Receipt;
}
export async function readReceipt(c: Captured, files: PrivateFiles): Promise<Receipt> {
  try {
    const baseline = captureReceipt(
      parse(await files.read(join(c.request.root, 'installation.json'), INSTALLATION_RECEIPT_BYTES)),
      c,
    );
    const selected = captureReceipt(
      parse(await files.read(configurationStatePath(c.request.root), INSTALLATION_RECEIPT_BYTES)),
      c,
    );
    for (const key of ['installationId', 'operationId', 'requestDigest', 'authority', 'configDigests'] as const) {
      valid(canonical(baseline[key]) === canonical(selected[key]));
    }
    return selected;
  } catch (cause) {
    if (cause instanceof ProvisionError && cause.code === 'cleanup') throw cause;
    throw new ProvisionError('recovery_required', { cause });
  }
}
export async function verifyConfigs(c: Captured, files: PrivateFiles, receipt: Receipt): Promise<void> {
  const directory = join(c.request.root, 'config');
  const names = await files.names(directory, [...configNames, 'configuration-state.json']);
  valid(names.length === configNames.length + 1);
  for (const name of configNames) {
    const bytes = await files.read(join(directory, name), name === 'agent-token' ? 128 : 262_144);
    valid(digest(Buffer.from(bytes).toString('utf8')) === receipt.configDigests[name]);
  }
}
