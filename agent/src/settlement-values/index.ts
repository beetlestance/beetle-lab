import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { captureOutputRetirementReply } from '@beetle/contracts/output-retirement';
import type { RetirementReply } from '@beetle/contracts/output-retirement';
import { AGENT_REPLAY_BYTES, captureSettlementRequest, cleanedReplyDigest, settlementRequestDigest } from '@beetle/contracts/output-settlement';
import { cleanupControl, cleanupDigest } from '../cleanup-control/index.js';
import { retirementDigest } from '../retirement-values/index.js';
export const agentChargeNames = ['spoolBytes','snapshotBytes','checkpointBytes','holdBytes','collectionBytes',
  'sourceBytes','deliveryBytes','absenceBytes','cleanupControlBytes'] as const;
export type AgentCharges = {readonly [K in typeof agentChargeNames[number]]:number};
export interface AgentSettlementTombstone {
 readonly version:1;readonly offerDigest:string;readonly settlementRequestDigest:string;
 readonly reply:Extract<RetirementReply,{readonly state:'cleaned'}>;readonly charges:AgentCharges;
 readonly disk:{readonly outputBytes:number;readonly stagingBytes:number};readonly chargedBytes:4096;
}
export const AGENT_TOMBSTONE_JSON_BYTES = AGENT_REPLAY_BYTES - 512;
function requireValue(value:unknown):asserts value {if(!value)throw Error('Invalid agent settlement tombstone');}
function record(value:unknown,keys:readonly string[],maximum:number):Record<string,unknown>{
 const copy:unknown=JSON.parse(encodeJson(value,maximum));
 requireValue(copy&&typeof copy==='object'&&!Array.isArray(copy));
 const row=copy as Record<string,unknown>;
 requireValue(Object.keys(row).length===keys.length&&keys.every(key=>Object.hasOwn(row,key)));return row;
}
function amount(value:unknown):number{
 requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);return value;
}
/** Pure compact metadata. Only the settlement owner may establish its underlying authority. */
export function captureAgentTombstone(input:unknown,expected:unknown):AgentSettlementTombstone{
 const row=record(input,['version','offerDigest','settlementRequestDigest','reply','charges','disk','chargedBytes'],AGENT_TOMBSTONE_JSON_BYTES);
 const request=captureSettlementRequest(expected);const reply=captureOutputRetirementReply(row.reply,request.retirement,retirementDigest);
 requireValue(reply.state==='cleaned'&&row.version===1&&row.chargedBytes===AGENT_REPLAY_BYTES&&cleanupDigest(row.offerDigest));
 requireValue(row.settlementRequestDigest===settlementRequestDigest(request,retirementDigest));
 requireValue(cleanedReplyDigest(reply,request.retirement,retirementDigest)===request.cleanupReplyDigest);
 const rawCharges=record(row.charges,agentChargeNames,1024);const charges={} as Record<typeof agentChargeNames[number],number>;
 let sum=0;for(const name of agentChargeNames){const value=amount(rawCharges[name]);requireValue(value<=Number.MAX_SAFE_INTEGER-sum);sum+=value;charges[name]=value;}
 requireValue(charges.cleanupControlBytes===cleanupControl.reservedBytes&&sum>=AGENT_REPLAY_BYTES);
 const disk=record(row.disk,['outputBytes','stagingBytes'],256);
 const outputBytes=amount(disk.outputBytes);const stagingBytes=amount(disk.stagingBytes);
 requireValue(outputBytes>0&&stagingBytes>=65536);
 return Object.freeze({version:1,offerDigest:row.offerDigest,settlementRequestDigest:row.settlementRequestDigest as string,
  reply,charges:Object.freeze(charges),disk:Object.freeze({outputBytes,stagingBytes}),chargedBytes:4096});
}
export function agentTombstoneDigest(input:unknown,expected:unknown):string{
 return retirementDigest('beetle-lab.agent-settlement-tombstone.v1\n'+encodeCanonicalJson(captureAgentTombstone(input,expected),AGENT_TOMBSTONE_JSON_BYTES));
}
