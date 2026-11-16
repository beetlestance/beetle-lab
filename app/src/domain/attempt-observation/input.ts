import { encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import { requireRule, SemanticError } from '../namespaces/index.js';
import type { AttemptIdentity, AttemptObservationInput } from './types.js';

export const MAX_ATTEMPT_OBSERVATION_BYTES = 73_728;
function copy(input: unknown, maximum: number): unknown {
  try { return JSON.parse(encodeJson(input, maximum)) as unknown; }
  catch { throw new SemanticError('invalid_value'); }
}
export function captureInput(input: AttemptObservationInput): AttemptObservationInput {
  const value = copy(input, MAX_ATTEMPT_OBSERVATION_BYTES * 2 + 1152) as AttemptObservationInput;
  requireRule(value !== null && typeof value === 'object' && Object.keys(value).length === 3
    && Object.hasOwn(value, 'expected') && Object.hasOwn(value, 'previous') && Object.hasOwn(value, 'incoming'));
  return value;
}
function requireScope(value: Omit<AttemptIdentity, 'intentDigest'>, expected: AttemptIdentity): void {
  requireRule(value.attemptId === expected.attemptId && value.organizationId === expected.organizationId
    && value.workspaceId === expected.workspaceId && value.generation === expected.generation);
}
export function captureIdentity(input: AttemptIdentity): AttemptIdentity {
  const value = copy(input, 1024) as AttemptIdentity;
  requireRule(value !== null && typeof value === 'object' && Object.keys(value).length === 5);
  requireRule(validatePrimitive('uuid', value.attemptId).ok && validatePrimitive('uuid', value.organizationId).ok
    && validatePrimitive('uuid', value.workspaceId).ok && value.generation === 1);
  requireRule(typeof value.intentDigest === 'string' && /^[a-f0-9]{64}$/.test(value.intentDigest));
  return value;
}
export function captureSnapshot(input: unknown, expected: AttemptIdentity): AttemptSnapshot {
  const result = validate('AttemptSnapshot', copy(input, MAX_ATTEMPT_OBSERVATION_BYTES));
  requireRule(result.ok);
  const value = result.value;
  requireScope(value, expected);
  requireRule(value.intentDigest === expected.intentDigest);
  requireRule(value.retainedStartSeq <= value.lastSeq ||
    value.lastSeq < Number.MAX_SAFE_INTEGER && value.retainedStartSeq === value.lastSeq + 1);
  if (value.result !== undefined) requireScope(value.result, expected);
  if (value.exportResult !== undefined) requireScope(value.exportResult, expected);
  return value;
}
