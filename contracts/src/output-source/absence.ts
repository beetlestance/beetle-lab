import { validate } from '../validate.js';
import type { OutputAbsence } from '../generated/types.js';
import { capture, checked, requireInput } from './capture.js';
import type { Owned, SourceScope } from './types.js';

export const OUTPUT_ABSENCE_BYTES = 2048;
/** One reason mapping consumed by Journal projection and native guard generation. */
export const OUTPUT_REJECTION_REASONS = Object.freeze({
  cancelled: 'cancelled', staging_policy: 'setup_failed',
  unsupported_capability: 'unsupported_capability', unapproved_profile: 'unsupported_capability',
  controls_unavailable: 'unsupported_capability', below_manifest_minimum: 'budget_unavailable',
  per_run_ceiling: 'budget_unavailable', timeout_ceiling: 'budget_unavailable', impossible_request: 'budget_unavailable',
} as const);
export interface AbsenceIdentity extends SourceScope {
  readonly intentDigest: string;
  readonly journalAuthority: string;
}
/** Captures a bounded producer value; only the Journal retirement owner grants
 * source absence. Schema validation alone does not establish native quiescence.
 */
export function captureOutputAbsence(input: unknown, expected?: AbsenceIdentity): Owned<OutputAbsence> {
  return checked(() => {
    const copy = capture(input, OUTPUT_ABSENCE_BYTES);
    const result = validate('OutputAbsence', copy); requireInput(result.ok);
    const value = result.value;
    if (value.admission.state === 'rejected') {
      requireInput(value.reason === OUTPUT_REJECTION_REASONS[value.admission.reason]);
    }
    if (expected) {
      for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest', 'journalAuthority'] as const) {
        requireInput(value[key] === expected[key]);
      }
    }
    return value;
  });
}
