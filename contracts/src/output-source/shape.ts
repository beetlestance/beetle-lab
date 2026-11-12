import { validate, validatePrimitive } from '../validate.js';
import type { ExecutionResult } from '../generated/types.js';
import { executionArtifacts, executionEngineId } from '../execution-result.js';
import { fields, requireInput, canonical, freeze } from './capture.js';
import { OUTPUT_SOURCE_RESULT_BYTES } from './limits.js';
import type { SourceScope, SourceBinding, PublicCore } from './types.js';

export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER, minimum = 0): asserts value is number {
  requireInput(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}
export function text(value: unknown): asserts value is string {
  requireInput(typeof value === 'string' && value.length > 0 && value.length <= 128);
}
export function sha(value: unknown): asserts value is string {
  requireInput(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
export function uuid(value: unknown): asserts value is string {
  requireInput(typeof value === 'string' && value.length === 36 && validatePrimitive('uuid', value).ok && value === value.toLowerCase());
}
export function scope(input: unknown): SourceScope {
  const value = fields(input, 'attemptId,organizationId,workspaceId,generation'); canonical(value, 640);
  for (const name of ['attemptId', 'organizationId', 'workspaceId']) requireInput(validatePrimitive('uuid', value[name]).ok);
  requireInput(value.generation === 1);
  return freeze({ attemptId: value.attemptId as string, organizationId: value.organizationId as string,
    workspaceId: value.workspaceId as string, generation: 1 as const });
}
export function sameScope(value: SourceScope, expected: SourceScope): void {
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) requireInput(value[key] === expected[key]);
}
export function binding(input: unknown): SourceBinding {
  const result = validate('SourceBinding', input); requireInput(result.ok);
  return result.value;
}
export function result(input: unknown, binding: SourceBinding): ExecutionResult {
  canonical(input, OUTPUT_SOURCE_RESULT_BYTES);
  const checked = validate('ExecutionResult', input); requireInput(checked.ok);
  const value = checked.value;
  sameScope(value as SourceScope, binding); requireInput(executionEngineId(value) === binding.engine.id);
  return value;
}
export function counts(input: { resultFileBytes: unknown; controlBytes: unknown; verifiedBytes: unknown }, result: ExecutionResult): void {
  integer(input.resultFileBytes, 1_048_576, 1); integer(input.controlBytes, 67_108_864); integer(input.verifiedBytes);
  let total = input.resultFileBytes + input.controlBytes;
  for (const artifact of executionArtifacts(result)) {
    requireInput(artifact.bytes <= Number.MAX_SAFE_INTEGER - total); total += artifact.bytes;
  }
  requireInput(input.verifiedBytes === total);
}
/** Structural checks on captured data, before any foreign hashing callback. */
export function publicCore(input: unknown, stored: boolean): PublicCore {
  const checked = stored ? validate('OutputManifest', input) : validate('OutputManifestCore', input);
  requireInput(checked.ok); const value = checked.value;
  const original = binding(value.binding); const engineResult = result(value.result, original);
  counts({ resultFileBytes: value.resultFileBytes, controlBytes: value.controlBytes, verifiedBytes: value.verifiedBytes }, engineResult);
  return { version: 1, binding: original, result: engineResult, resultFileBytes: value.resultFileBytes as number,
    controlBytes: value.controlBytes as number, verifiedBytes: value.verifiedBytes as number };
}
