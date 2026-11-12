import { encodeCanonicalJson, encodeJson } from '../json.js';
import { freezeJson } from '../freeze.js';
import { validate } from '../validate.js';
import { RUNNER_MAXIMUM_OFFER_BYTES } from '../limits.js';
import type { StandaloneExportAssignment } from '../generated/types.js';
import type { ResultDigest } from '../result-seal-core.js';
import { ExportContractError, EXPORT_ASSIGNMENT_BYTES, EXPORT_CONTROL_BYTES, EXPORT_RESULT_BYTES } from './values.js';
export const exportAssignmentPrefix = 'beetle-lab.standalone-export-assignment.v1\n';
function snapshot(input: unknown): StandaloneExportAssignment {
  let copy: unknown;
  try {copy = JSON.parse(encodeJson(input, EXPORT_ASSIGNMENT_BYTES)) as unknown;} catch {throw new ExportContractError('invalid_assignment');}
  const checked = validate('StandaloneExportAssignment', copy); if (!checked.ok) throw new ExportContractError('invalid_assignment');
  const assignment = checked.value;
  try {encodeJson(assignment.offer, RUNNER_MAXIMUM_OFFER_BYTES);} catch {throw new ExportContractError('invalid_assignment');}
  if (!validate('Offer', assignment.offer).ok) throw new ExportContractError('invalid_assignment');
  if (assignment.offer.secretReferences.length !== 0) throw new ExportContractError('unsupported_secrets');
  if (assignment.options.maximumBuildBytes + EXPORT_CONTROL_BYTES + EXPORT_RESULT_BYTES > assignment.offer.budget.outputBytes) throw new ExportContractError('budget_exceeded');
  return assignment;
}
function preimage(value: StandaloneExportAssignment): string {
  const body: Record<string, unknown> = {...value}; delete body.assignmentDigest;
  return exportAssignmentPrefix + encodeCanonicalJson(body, EXPORT_ASSIGNMENT_BYTES);
}
function digest(value: StandaloneExportAssignment, hash: ResultDigest): string {
  try {const result = hash(preimage(value)); if (typeof result !== 'string' || !/^[a-f0-9]{64}$/.test(result)) throw new Error(); return result;}
  catch {throw new ExportContractError('digest_failed');}
}
export function createStandaloneExportAssignment(input: unknown, hash: ResultDigest): StandaloneExportAssignment {
  let body: unknown;
  try {body = JSON.parse(encodeJson(input, EXPORT_ASSIGNMENT_BYTES)) as unknown;} catch {throw new ExportContractError('invalid_assignment');}
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'assignmentDigest')) throw new ExportContractError('invalid_assignment');
  const value = snapshot({...body, assignmentDigest: '0'.repeat(64)});
  value.assignmentDigest = digest(value, hash); return freezeJson(value);
}
export function captureStandaloneExportAssignment(input: unknown, hash: ResultDigest): StandaloneExportAssignment {
  const value = snapshot(input); if (digest(value, hash) !== value.assignmentDigest) throw new ExportContractError('digest_mismatch'); return freezeJson(value);
}
