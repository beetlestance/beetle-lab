import { createResultSealer } from '../result-seal-core.js';
import type { ResultDigest } from '../result-seal-core.js';
import { validate } from '../validate.js';
import type { StandaloneExportResult } from '../generated/types.js';
import { captureExportExpectation, exportExpectation } from './expectation.js';
import type { ExportResultExpectation } from './expectation.js';
import { ExportContractError, EXPORT_RESULT_BYTES } from './values.js';
export const exportResultPrefix = 'beetle-lab.standalone-export-result.v1\n';
const result = createResultSealer({prefix: exportResultPrefix, maximumBytes: EXPORT_RESULT_BYTES, decode(input: unknown) {
  const checked = validate('StandaloneExportResult', input); if (!checked.ok) throw new Error('Invalid export result'); return checked.value;
}});
export const sealStandaloneExportResult = result.seal;
export const verifyStandaloneExportResultSeal = result.verify;
export const standaloneExportResultSealPreimage = result.preimage;
const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
/** Binding/integrity only: physical producer admission and native custody are separate. */
export function captureStandaloneExportResult(input: unknown, expected: unknown, hash: ResultDigest): StandaloneExportResult {
  return captureExportResultForExpectation(input,exportExpectation(expected,hash),hash);
}
export function captureExportResultForExpectation(input: unknown, expected: unknown, hash: ResultDigest): StandaloneExportResult {
  const assignment=captureExportExpectation(expected);
  const checked = result.verify(input, hash); if (!checked.ok) throw new ExportContractError('invalid_result');
  const value = checked.value;
  requireBinding(value, assignment); requireBuildEvidence(value, assignment.maximumBuildBytes);
  return value;
}
function requireBinding(value: StandaloneExportResult, assignment: ExportResultExpectation): void {
  const offer = assignment;
  if (!same(value.exportId, assignment.exportId) || !same(value.attemptId, offer.attemptId) || !same(value.organizationId, offer.organizationId)
    || !same(value.workspaceId, offer.workspaceId) || value.assignmentDigest !== assignment.assignmentDigest) throw new ExportContractError('binding_mismatch');
}
function requireBuildEvidence(value: StandaloneExportResult, maximumBuildBytes: number): void {
  if (!Number.isFinite(Date.parse(value.seal.sealedAt))) throw new ExportContractError('invalid_result');
  const usage = value.buildUsage;
  if (usage && (usage.bytes > usage.peakBytes || usage.peakBytes > maximumBuildBytes)) throw new ExportContractError('budget_exceeded');
  if (value.status === 'succeeded') requireScript(value);
}
function requireScript(value: StandaloneExportResult): void {
  const artifact = value.artifact; const usage = value.buildUsage;
  if (!artifact || !usage || artifact.bytes !== usage.bytes) throw new ExportContractError('invalid_result');
  const artifactTime = Date.parse(artifact.sealedAt); const resultTime = Date.parse(value.seal.sealedAt);
  if (!Number.isFinite(artifactTime) || artifactTime > resultTime) throw new ExportContractError('invalid_result');
}
