import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureOutputRetirementReply } from '@beetle/contracts/output-retirement';
import { captureSettlementRequest,cleanedReplyDigest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import { cleanupDigest } from '../cleanup-control/index.js';
import { retirementDigest } from '../retirement-values/index.js';
import { agentChargeNames,AGENT_TOMBSTONE_JSON_BYTES } from './admitted.js';
import type { AdmittedAgentTombstone,AgentCharges } from './admitted.js';
export interface RejectedAgentTombstone extends Omit<AdmittedAgentTombstone,'version'|'disk'> {
 readonly version:2;readonly funding:{readonly kind:'rejected_control';readonly reservedBytes:16384};
 readonly disk:{readonly outputBytes:0;readonly stagingBytes:0};
}
function requireValue(value:unknown):asserts value{if(!value)throw Error('Invalid rejected agent tombstone');}
function record(input:unknown,keys:readonly string[],maximum:number):Record<string,unknown>{
 const copy:unknown=JSON.parse(encodeJson(input,maximum));requireValue(copy&&typeof copy==='object'&&!Array.isArray(copy));
 const row=copy as Record<string,unknown>;requireValue(Object.keys(row).length===keys.length&&keys.every(key=>Object.hasOwn(row,key)));return row;
}
function charges(input:unknown):AgentCharges{
 const row=record(input,agentChargeNames,1024);let total=0;
 for(const name of agentChargeNames){const value=row[name];requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER-total);total+=value;}
 requireValue(row.holdBytes===0&&row.collectionBytes===0&&row.sourceBytes===0&&row.deliveryBytes===0&&row.cleanupControlBytes===0);
 requireValue(typeof row.absenceBytes==='number'&&row.absenceBytes>0);return Object.freeze(row) as unknown as AgentCharges;
}
export function captureRejectedTombstone(input:unknown,expected:unknown):RejectedAgentTombstone{
 const row=record(input,['version','offerDigest','settlementRequestDigest','reply','charges','disk','chargedBytes','funding'],AGENT_TOMBSTONE_JSON_BYTES);
 const request=captureSettlementRequest(expected);const reply=captureOutputRetirementReply(row.reply,request.retirement,retirementDigest);
 requireValue(request.retirement.closure.kind==='absence'&&reply.state==='cleaned'&&row.version===2&&row.chargedBytes===4096&&cleanupDigest(row.offerDigest));
 requireValue(row.settlementRequestDigest===settlementRequestDigest(request,retirementDigest));
 requireValue(cleanedReplyDigest(reply,request.retirement,retirementDigest)===request.cleanupReplyDigest);
 const funding=record(row.funding,['kind','reservedBytes'],128);requireValue(funding.kind==='rejected_control'&&funding.reservedBytes===16384);
 const disk=record(row.disk,['outputBytes','stagingBytes'],128);requireValue(disk.outputBytes===0&&disk.stagingBytes===0);
 return Object.freeze({version:2,offerDigest:row.offerDigest,settlementRequestDigest:row.settlementRequestDigest as string,reply,
  charges:charges(row.charges),funding:Object.freeze({kind:'rejected_control',reservedBytes:16384}),
  disk:Object.freeze({outputBytes:0,stagingBytes:0}),chargedBytes:4096});
}
export function rejectedTombstoneDigest(input:unknown,expected:unknown):string{
 return retirementDigest('beetle-lab.agent-settlement-tombstone.v2\n'+encodeCanonicalJson(captureRejectedTombstone(input,expected),AGENT_TOMBSTONE_JSON_BYTES));
}
