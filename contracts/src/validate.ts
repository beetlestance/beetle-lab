import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { messageSchemas, schemas } from './generated/schemas.js';
import { schema as common } from './generated/common.js';
import { encodeJson } from './json.js';
import { RUNNER_MAXIMUM_CONFIG_BYTES } from './limits.js';
import type { Uuid, Cursor, ProtocolTypes, SecretReference, Offer } from './generated/types.js';

export type ProtocolName = keyof ProtocolTypes;
export interface StructuralIssue { readonly path: string; readonly code: string }
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly StructuralIssue[] };

const ajv = new Ajv2020({ strict: true, allErrors: false, validateFormats: true,
  coerceTypes: false, useDefaults: false, removeAdditional: false });
// ajv-formats' CJS declaration wraps its callable default under ESM interop.
const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);
const validators = Object.fromEntries(Object.entries(messageSchemas).map(([name, schema]) => {
  const validator = ajv.getSchema(schema.$id);
  if (!validator) throw new Error(`Missing shipped schema: ${name}`);
  return [name, validator];
})) as Record<ProtocolName, ValidateFunction>;

interface PrimitiveTypes { uuid: Uuid; cursor: Cursor; secretReference: SecretReference }
const primitives = Object.fromEntries(['uuid', 'cursor', 'secretReference'].map(name => {
  const validator = ajv.getSchema(`${common.$id}#/$defs/${name}`);
  if (!validator) throw new Error(`Missing shipped primitive: ${name}`);
  return [name, validator];
})) as Record<keyof PrimitiveTypes, ValidateFunction>;

export function validatePrimitive<N extends keyof PrimitiveTypes>(name: N, input: unknown): ValidationResult<PrimitiveTypes[N]> {
  const validator = primitives[name];
  if (!validator(input)) return { ok: false, issues: safeIssues(validator.errors) };
  return { ok: true, value: input as PrimitiveTypes[N] };
}

function safeIssues(errors: ErrorObject[] | null | undefined): readonly StructuralIssue[] {
  return Object.freeze((errors ?? []).slice(0, 16).map(error => Object.freeze({
    path: error.instancePath.slice(0, 256), code: error.keyword,
  })));
}

/** Validates unknown, already-parsed JSON without coercion, defaults or removal. */
export function validate<N extends ProtocolName>(name: N, input: unknown): ValidationResult<ProtocolTypes[N]> {
  const validator = validators[name];
  if (!validator(input)) return { ok: false, issues: safeIssues(validator.errors) };
  if (name === 'Offer') {
    try { encodeJson((input as Offer).config, RUNNER_MAXIMUM_CONFIG_BYTES); }
    catch { return { ok: false, issues: Object.freeze([Object.freeze({ path: '/config', code: 'limit' })]) }; }
  }
  return { ok: true, value: input as ProtocolTypes[N] };
}
