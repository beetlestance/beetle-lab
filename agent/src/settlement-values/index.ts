import { encodeJson } from '@beetle/contracts';
import { captureAdmittedTombstone,admittedTombstoneDigest,AGENT_TOMBSTONE_JSON_BYTES } from './admitted.js';
import type { AdmittedAgentTombstone } from './admitted.js';
import { captureRejectedTombstone,rejectedTombstoneDigest } from './rejected.js';
import type { RejectedAgentTombstone } from './rejected.js';
export { agentChargeNames,AGENT_TOMBSTONE_JSON_BYTES } from './admitted.js';
export type { AgentCharges } from './admitted.js';
export type { AdmittedAgentTombstone } from './admitted.js';
export type { RejectedAgentTombstone } from './rejected.js';
export type AgentSettlementTombstone=AdmittedAgentTombstone|RejectedAgentTombstone;
function version(input:unknown){
 const copy:unknown=JSON.parse(encodeJson(input,AGENT_TOMBSTONE_JSON_BYTES));
 if(!copy||typeof copy!=='object'||Array.isArray(copy))throw Error('Invalid agent tombstone');
 return{copy,version:Reflect.get(copy,'version') as unknown};
}
export function captureAgentTombstone(input:unknown,expected:unknown):AgentSettlementTombstone{
 const captured=version(input);return captured.version===2?captureRejectedTombstone(captured.copy,expected):captureAdmittedTombstone(captured.copy,expected);
}
export function agentTombstoneDigest(input:unknown,expected:unknown):string{
 const captured=version(input);return captured.version===2?rejectedTombstoneDigest(captured.copy,expected):admittedTombstoneDigest(captured.copy,expected);
}
