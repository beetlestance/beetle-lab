import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { retirementDigest,noTaskIdentity } from '../retirement-values/index.js';
export const rejectedCleanupLimits=Object.freeze({
 version:1 as const,reservedBytes:16384 as const,maximumFunded:64,
 controlBodyBytes:1024,controlRowBytes:1536,intentBytes:4096,intentRowBytes:4608,
 receiptBytes:2048,receiptRowBytes:2560,tombstoneRowBytes:4096,counterBytes:512,
});
export const rejectedCleanupPeakBytes=rejectedCleanupLimits.controlRowBytes+rejectedCleanupLimits.intentRowBytes
 +rejectedCleanupLimits.receiptRowBytes+rejectedCleanupLimits.tombstoneRowBytes+rejectedCleanupLimits.counterBytes;
export interface RejectedCleanupControl {
 readonly version:1;readonly organizationId:string;readonly workspaceId:string;readonly attemptId:string;readonly generation:1;
 readonly intentDigest:string;readonly requestDigest:string;readonly namespaceIdentity:string;readonly taskName:string;
 readonly reservedBytes:16384;
}
export interface RejectedControlBinding {readonly request:unknown;readonly namespaceIdentity:string;readonly taskName:string}
export class RejectedCleanupValueError extends Error {constructor(){super('Invalid rejected cleanup metadata');}}
function requireValue(value:unknown):asserts value{if(!value)throw new RejectedCleanupValueError();}
function binding(input:RejectedControlBinding){
 const native=noTaskIdentity(input);const request=native.request;
 return{version:1 as const,organizationId:request.organizationId,workspaceId:request.workspaceId,attemptId:request.attemptId,
  generation:1 as const,intentDigest:request.intentDigest,requestDigest:native.requestDigest,
  namespaceIdentity:input.namespaceIdentity,taskName:input.taskName,reservedBytes:16384 as const};
}
/** Metadata equality only. Worker facts, prepaid capacity and native absence need separate owners. */
export function captureRejectedControl(input:unknown,expected:RejectedControlBinding):RejectedCleanupControl{
 const wanted=binding(expected);const copy:unknown=JSON.parse(encodeJson(input,rejectedCleanupLimits.controlBodyBytes));
 requireValue(encodeCanonicalJson(copy,rejectedCleanupLimits.controlBodyBytes)===encodeCanonicalJson(wanted,rejectedCleanupLimits.controlBodyBytes));
 return Object.freeze(wanted);
}
export function rejectedControlValue(expected:RejectedControlBinding):RejectedCleanupControl{
 return captureRejectedControl(binding(expected),expected);
}
export function rejectedControlDigest(input:unknown,expected:RejectedControlBinding):string{
 return retirementDigest('beetle-lab.rejected-cleanup-control.v1\n'
  +encodeCanonicalJson(captureRejectedControl(input,expected),rejectedCleanupLimits.controlBodyBytes));
}
