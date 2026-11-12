import { captureExportExpectation, encodeCanonicalJson, validatePrimitive } from '@beetle/contracts';
import type { ExportResultExpectation } from '@beetle/contracts';
import { captureEventBinding, captureFields as fields } from '../events/index.js';
import type { EventBinding } from '../events/index.js';
import { immutableSnapshot } from '../namespaces/index.js';

/** Existing Run custody identities remain byte-for-byte unchanged. */
export interface ExportOutputBinding {
  readonly purpose: 'standalone_export';
  readonly key: {readonly exportId: string; readonly attempt: EventBinding['key']['attempt']};
  readonly journalAuthority: string;
  readonly expectation: ExportResultExpectation;
}
export type OutputBinding = EventBinding | ExportOutputBinding;
export function isExportOutput(value: OutputBinding): value is ExportOutputBinding {
  return Object.hasOwn(value, 'purpose');
}
/** Own data fields, closed purpose branch and compact immutable content binding. */
export function captureOutputBinding(input: unknown): OutputBinding {
  if (input === null || typeof input !== 'object') throw new Error('invalid_output_binding');
  if (!Object.hasOwn(input, 'purpose')) return captureEventBinding(input);
  const value = fields(input, ['purpose', 'key', 'journalAuthority', 'expectation']);
  if (value.purpose !== 'standalone_export') throw new Error('invalid_output_binding');
  const key = fields(value.key, ['exportId', 'attempt']);
  if (!validatePrimitive('uuid', key.exportId).ok) throw new Error('invalid_output_binding');
  const attempt = originalAttempt(key.attempt);
  const expectation = captureExportExpectation(fields(value.expectation, ['exportId', 'attemptId', 'organizationId', 'workspaceId', 'assignmentDigest', 'maximumBuildBytes']));
  requireExpectationOwner(expectation, key.exportId, attempt);
  if (!validatePrimitive('uuid', value.journalAuthority).ok) throw new Error('invalid_output_binding');
  const authority = value.journalAuthority as string;
  return immutableSnapshot({purpose: 'standalone_export', key: {exportId: key.exportId as string, attempt},
    journalAuthority: authority, expectation});
}
export function outputOwnerId(binding: OutputBinding): string {
  return isExportOutput(binding) ? binding.key.exportId : binding.key.runId;
}
export function sameOutputBinding(a: OutputBinding, b: OutputBinding): boolean {
  return encodeCanonicalJson(a, 4096) === encodeCanonicalJson(b, 4096);
}

function originalAttempt(input: unknown): EventBinding['key']['attempt'] {
  const value = fields(input, ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest']);
  if (![value.organizationId, value.workspaceId, value.attemptId].every(id => validatePrimitive('uuid', id).ok)
    || value.generation !== 1 || typeof value.intentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.intentDigest)) {
    throw new Error('invalid_output_binding');
  }
  return value as unknown as EventBinding['key']['attempt'];
}

function requireExpectationOwner(expectation: ExportResultExpectation, exportId: unknown, attempt: EventBinding['key']['attempt']): void {
  if (expectation.exportId !== exportId || expectation.attemptId !== attempt.attemptId
    || expectation.organizationId !== attempt.organizationId || expectation.workspaceId !== attempt.workspaceId) {
    throw new Error('invalid_output_binding');
  }
}
