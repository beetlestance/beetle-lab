import { types } from 'node:util';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { OUTPUT_CHUNK_BYTES, OUTPUT_FILE_RECORD_BYTES } from '../../../../ports/output-bytes.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { OutputArtifactState } from '../../../../ports/output-custody.js';
import { fail } from './errors.js';

function data(input: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  if (!descriptor?.enumerable || !('value' in descriptor)) fail('invalid_input');
  return descriptor.value as unknown;
}
export function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || types.isProxy(input)) fail('invalid_input');
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) fail('invalid_input');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) fail('invalid_input');
  const values: Record<string, unknown> = {};
  for (const name of names) {
    values[name] = data(input, name);
  }
  return values;
}
const artifactFields = ['ordinal', 'artifactId', 'token', 'bytes', 'sha256', 'offset', 'phase', 'identity', 'writer', 'version'];
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) && validatePrimitive('uuid', value).ok;
}
function hash(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
export function token(input: unknown): string {
  const record = fields(input, ['binding', 'artifact']); const artifact = fields(record.artifact, artifactFields);
  if (!uuid(artifact.token)) fail('invalid_input'); return artifact.token;
}
function artifact(input: unknown): OutputArtifactState {
  const value = fields(input, artifactFields);
  if (![value.artifactId, value.token].every(uuid) || !hash(value.sha256)) fail('invalid_input');
  if (![value.ordinal, value.bytes, value.offset].every(item => integer(item)) || !integer(value.version, 1)) fail('invalid_input');
  if ((value.offset as number) > (value.bytes as number)) fail('invalid_input');
  artifactState(value);
  return value as unknown as OutputArtifactState;
}
function artifactState(value: Record<string, unknown>): void {
  if (typeof value.phase !== 'string' || !['transferring', 'publishing', 'published'].includes(value.phase)) fail('invalid_input');
  if (value.identity !== null && !hash(value.identity)) fail('invalid_input');
  if (value.writer !== null && !uuid(value.writer)) fail('invalid_input');
  if (value.phase !== 'transferring' && value.offset !== value.bytes) fail('invalid_input');
}
function binding(input: unknown): OutputFileRecord['binding'] {
  const value = fields(input, ['key', 'journalAuthority']);
  const key = fields(value.key, ['runId', 'attempt']);
  const attempt = fields(key.attempt, ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest']);
  if (![value.journalAuthority, key.runId, attempt.organizationId, attempt.workspaceId, attempt.attemptId].every(uuid)) fail('invalid_input');
  if (attempt.generation !== 1 || !hash(attempt.intentDigest)) fail('invalid_input');
  return captureEventBinding({ key: { runId: key.runId, attempt }, journalAuthority: value.journalAuthority });
}
export function record(input: unknown): OutputFileRecord {
  try {
    const value = fields(input, ['binding', 'artifact']);
    // Only validated primitive leaves and owned fixed-shape snapshots reach encoding.
    const captured = { binding: binding(value.binding), artifact: artifact(value.artifact) };
    return JSON.parse(encodeJson(captured, OUTPUT_FILE_RECORD_BYTES)) as OutputFileRecord;
  } catch { fail('invalid_input'); }
}
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength')!.get!;
export function chunk(input: unknown): Uint8Array {
  if (!types.isUint8Array(input)) fail('invalid_input');
  const length = Reflect.apply(byteLength, input, []) as number;
  if (length < 1 || length > OUTPUT_CHUNK_BYTES) fail('invalid_input');
  const captured = new Uint8Array(length); Uint8Array.prototype.set.call(captured, input); return captured;
}
