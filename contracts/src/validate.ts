import { createRunnerRegistry } from './validator-registry.js';
import type { PrimitiveTypes } from './validator-registry.js';
import type { ErrorObject } from 'ajv';
import { encodeJson } from './json.js';
import { RUNNER_MAXIMUM_CONFIG_BYTES } from './limits.js';
import type { ProtocolTypes, Offer } from './generated/types.js';

export type ProtocolName = keyof ProtocolTypes;
export interface StructuralIssue { readonly path: string; readonly code: string }
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly StructuralIssue[] };

const { validators, primitives } = createRunnerRegistry();

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
