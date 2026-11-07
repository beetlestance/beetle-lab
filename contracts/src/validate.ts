import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { messageSchemas, schemas } from './generated/schemas.js';
import type { ProtocolTypes } from './generated/types.js';

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

function safeIssues(errors: ErrorObject[] | null | undefined): readonly StructuralIssue[] {
  return Object.freeze((errors ?? []).slice(0, 16).map(error => Object.freeze({
    path: error.instancePath.slice(0, 256), code: error.keyword,
  })));
}

/** Validates unknown, already-parsed JSON without coercion, defaults or removal. */
export function validate<N extends ProtocolName>(name: N, input: unknown): ValidationResult<ProtocolTypes[N]> {
  const validator = validators[name];
  if (!validator(input)) return { ok: false, issues: safeIssues(validator.errors) };
  return { ok: true, value: input as ProtocolTypes[N] };
}
