import { encodeJson } from '../json.js';
import { validatePrimitive } from '../validate.js';
import { captureStandaloneExportAssignment } from './assignment.js';
import type { ResultDigest } from '../result-seal-core.js';
import { ExportContractError } from './values.js';
export interface ExportResultExpectation {
  readonly exportId:string; readonly attemptId:string; readonly organizationId:string; readonly workspaceId:string;
  readonly assignmentDigest:string; readonly maximumBuildBytes:number;
}
/** Compact content binding only; callers still establish durable/native authority. */
export function captureExportExpectation(input: unknown): ExportResultExpectation {
  let value: ExportResultExpectation;
  try {value=JSON.parse(encodeJson(input,1024)) as ExportResultExpectation;} catch {throw new ExportContractError('binding_mismatch');}
  if (!value || Object.keys(value).sort().join(',') !== 'assignmentDigest,attemptId,exportId,maximumBuildBytes,organizationId,workspaceId') throw new ExportContractError('binding_mismatch');
  const ids=[value.exportId,value.attemptId,value.organizationId,value.workspaceId];
  if (!ids.every(id=>validatePrimitive('uuid',id).ok) || !(typeof value.assignmentDigest === 'string' && /^[a-f0-9]{64}$/.test(value.assignmentDigest))) throw new ExportContractError('binding_mismatch');
  if (!Number.isSafeInteger(value.maximumBuildBytes) || value.maximumBuildBytes < 1 || value.maximumBuildBytes > 64 * 1048576) throw new ExportContractError('binding_mismatch');
  return Object.freeze(value);
}
export function exportExpectation(input: unknown, hash: ResultDigest): ExportResultExpectation {
  const assignment=captureStandaloneExportAssignment(input,hash);const offer=assignment.offer;
  return captureExportExpectation({exportId:assignment.exportId,attemptId:offer.attemptId,organizationId:offer.organizationId,
    workspaceId:offer.workspaceId,assignmentDigest:assignment.assignmentDigest,maximumBuildBytes:assignment.options.maximumBuildBytes});
}
