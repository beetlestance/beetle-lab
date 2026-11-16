import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { encodeJson } from '@beetle/contracts';
import { schemas } from '../generated/schemas.js';
import { freezeSchema } from '../schema-freeze.js';
import { boundary, fail, rejected } from './failure.js';
import { compileSuite } from './index.js';
import { suiteLimits } from './limits.js';
import type { CompileInput, CompiledSuite, DeepReadonly, Result, SuiteConfig,
  ValidatedCompileInput, ValidatedSuiteConfig } from './types.js';
const ajv = new Ajv2020({ strict: true, allErrors: false, ownProperties: true });
for (const schema of schemas) ajv.addSchema(schema);
const suiteValidator = ajv.getSchema<SuiteConfig>('https://beetle.test/contracts/engines/k6/v1/suite');
const inputValidator = ajv.getSchema<CompileInput>('https://beetle.test/contracts/engines/k6/v1/compile-input');
if (!suiteValidator || !inputValidator) throw new Error('Missing shipped k6 suite schemas');
const validateConfig = suiteValidator;
const validateInput = inputValidator;
export function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function validateSuiteConfig(input: unknown): Result<ValidatedSuiteConfig> {
  const snapshot = boundary(() => JSON.parse(encodeJson(input, suiteLimits.configBytes)) as unknown);
  if (!snapshot.ok) return snapshot;
  if (!validateConfig(snapshot.value)) return rejected('schema');
  return { ok: true, value: freezeSchema(snapshot.value) as ValidatedSuiteConfig };
}
function properties(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) fail('invalid_json');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name in value) {
    if (!Object.hasOwn(value, name)) continue;
    if (!allowed.includes(name)) fail('schema');
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor)) fail('invalid_json');
    result[name] = descriptor.value;
  }
  return result;
}
function snapshotItem(value: unknown): { item: CompileInput['inputs'][number]; bytes: number } {
  const item = properties(value, ['ref', 'content']);
  if (typeof item.content !== 'string' || item.content.length > suiteLimits.inputBytes) fail('input_limit');
  const bytes = Buffer.byteLength(item.content, 'utf8');
  if (bytes > suiteLimits.inputBytes) fail('input_limit');
  const ref: unknown = JSON.parse(encodeJson(item.ref, 1024));
  // Structural validation follows the bounded snapshot; actual bytes drive aggregate admission.
  return { item: { ref: ref as CompileInput['inputs'][number]['ref'], content: item.content }, bytes };
}
function snapshotInput(value: unknown): unknown {
  const root = properties(value, ['engine', 'targetOverride', 'inputs']);
  const inputs = root.inputs;
  if (!Array.isArray(inputs) || inputs.length > 128 || Object.getPrototypeOf(inputs) !== Array.prototype) fail('schema');
  const metadata = JSON.parse(encodeJson({ engine: root.engine,
    ...(root.targetOverride === undefined ? {} : { targetOverride: root.targetOverride }) }, suiteLimits.configBytes)) as object;
  let total = 0;
  const snapshots: CompileInput['inputs'] = [];
  for (let index = 0; index < inputs.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(inputs, String(index));
    if (!descriptor || !('value' in descriptor)) fail('invalid_json');
    const item = snapshotItem(descriptor.value);
    total += item.bytes;
    if (total > suiteLimits.loadedBytes) fail('input_limit');
    snapshots.push(item.item);
  }
  return { ...metadata, inputs: snapshots };
}
export function validateCompileInput(value: unknown): Result<ValidatedCompileInput> {
  const snapshot = boundary(() => snapshotInput(value));
  if (!snapshot.ok) return snapshot;
  if (!validateInput(snapshot.value)) return rejected('schema');
  const checked = snapshot.value as CompileInput;
  for (const item of checked.inputs) {
    if (Buffer.byteLength(item.content, 'utf8') !== item.ref.bytes || sha256(item.content) !== item.ref.sha256) return rejected('input_integrity', '/inputs');
  }
  return { ok: true, value: freezeSchema(checked) as unknown as ValidatedCompileInput };
}
/** Node-only convenience boundary: checks actual input UTF-8 bytes and SHA-256 before parsing content. */
export function validateAndCompileSuite(config: unknown, input: unknown): Result<DeepReadonly<CompiledSuite>> {
  const validated = validateSuiteConfig(config);
  if (!validated.ok) return validated;
  const dependencies = validateCompileInput(input);
  if (!dependencies.ok) return dependencies;
  return compileSuite(validated.value, { input: dependencies.value, digest: sha256 });
}
