import { encodeCanonicalJson, validatePrimitive } from '../index.js';
export const INSTALLATION_RECEIPT_BYTES = 131072;
export const configurationNames = ['installation.json', 'backend-agent.json', 'agent.json'] as const;
export type ConfigurationName = typeof configurationNames[number];
export interface ConfigurationGeneration {
  readonly version: 1;
  readonly operationId: string;
  readonly installationId: string;
  readonly previousDigest: string;
  readonly configurations: Readonly<Record<ConfigurationName, unknown>>;
  readonly digest: string;
}
type Digest = (text: string) => string;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function valid(condition: unknown): asserts condition {
  if (!condition) throw new Error('Installation configuration requires recovery');
}
function record(value: unknown): asserts value is Record<string, unknown> {
  valid(value !== null && typeof value === 'object' && !Array.isArray(value));
}
function fields(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  record(value); valid(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
export function generationDigest(value: Omit<ConfigurationGeneration, 'digest'>, digest: Digest): string {
  return digest(encodeCanonicalJson(value, INSTALLATION_RECEIPT_BYTES));
}
export function captureGeneration(value: unknown, installationId: string, previousDigest: string,
  digest: Digest): ConfigurationGeneration {
  fields(value, ['version', 'operationId', 'installationId', 'previousDigest', 'configurations', 'digest']);
  valid(value.version === 1 && validatePrimitive('uuid', value.operationId).ok);
  valid(validatePrimitive('uuid', installationId).ok && value.installationId === installationId);
  valid(hash(previousDigest) && value.previousDigest === previousDigest && hash(value.digest));
  fields(value.configurations, configurationNames);
  for (const configuration of Object.values(value.configurations)) record(configuration);
  const captured = value as unknown as ConfigurationGeneration;
  const { digest: _digest, ...intent } = captured; void _digest;
  valid(generationDigest(intent, digest) === captured.digest);
  return JSON.parse(encodeCanonicalJson(captured, INSTALLATION_RECEIPT_BYTES)) as ConfigurationGeneration;
}
/** The ready receipt is the sole selector. An unfinished operation always fences startup. */
export function selectInstalledConfiguration(receipt: unknown, name: ConfigurationName,
  baseline: string, digest: Digest): unknown {
  record(receipt);
  valid(receipt.version === 1 && receipt.phase === 'ready' && validatePrimitive('uuid', receipt.installationId).ok);
  record(receipt.configDigests);
  valid(hash(receipt.configDigests[name]) && digest(baseline) === receipt.configDigests[name]);
  let selected: unknown = JSON.parse(baseline) as unknown;
  if (Object.hasOwn(receipt, 'generation')) {
    valid(typeof receipt.installationId === 'string' && typeof receipt.requestDigest === 'string');
    selected = captureGeneration(receipt.generation, receipt.installationId, receipt.requestDigest, digest).configurations[name];
  }
  record(selected);
  if (name === 'installation.json') valid(selected.id === receipt.installationId);
  if (name === 'backend-agent.json') valid(selected.expectedInstallationId === receipt.installationId);
  if (name === 'agent.json') {
    record(selected.installation); valid(selected.installation.installationId === receipt.installationId);
  }
  return selected;
}
