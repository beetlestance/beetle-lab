import { captureOutputRetirementRequest,outputRetirementDigest } from '@beetle/contracts/output-retirement';
import { retirementDigest } from './capture.js';
export interface NoTaskIdentityInput {readonly request:unknown;readonly namespaceIdentity:string;readonly taskName:string}
/** Closed metadata only; C1 and rejected-control funding require their separate positive worker owners. */
export function noTaskIdentity(input:NoTaskIdentityInput){
 const request=captureOutputRetirementRequest(input.request);
 if(request.closure.kind!=='absence'||typeof input.namespaceIdentity!=='string'||!/^[0-9a-f]{64}$/.test(input.namespaceIdentity)
  ||typeof input.taskName!=='string'||!/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(input.taskName))throw Error('Invalid no-task identity');
 return{request,requestDigest:outputRetirementDigest(request,retirementDigest),namespaceIdentity:input.namespaceIdentity,taskName:input.taskName};
}
