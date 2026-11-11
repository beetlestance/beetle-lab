import { createApiRegistry } from './validator-registry.js';
import type { ErrorObject } from 'ajv';
import type { ValidationResult } from '../validate.js';
import type { ApiTypes } from './generated/types.js';

const { validators } = createApiRegistry();

function safeIssues(errors: ErrorObject[] | null | undefined) {
  return Object.freeze((errors ?? []).slice(0, 16).map(error => Object.freeze({
    // AJV instance paths may contain attacker-controlled object keys. Expose only known field segments.
    path: /^\/(?:[A-Za-z][A-Za-z0-9]*|[0-9]{1,6})(?:\/(?:[A-Za-z][A-Za-z0-9]*|[0-9]{1,6}))*$/.test(error.instancePath)
      ? error.instancePath.slice(0, 256) : '',
    code: error.keyword,
  })));
}

/** Validates already-parsed JSON. Input bounds, route/scope equality and domain checks are consumer duties. */
export function validateApi<N extends keyof ApiTypes>(name: N, input: unknown): ValidationResult<ApiTypes[N]> {
  const validator = validators[name];
  if (!validator(input)) return { ok: false, issues: safeIssues(validator.errors) };
  return { ok: true, value: input as ApiTypes[N] };
}
