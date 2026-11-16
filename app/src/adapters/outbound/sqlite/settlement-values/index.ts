import { encodeCanonicalJson,encodeJson,validatePrimitive } from '@beetle/contracts';
import { BACKEND_CLEANUP_CONTROL_BYTES,BACKEND_CLEANUP_BUCKETS } from '../../../../ports/cleanup-control.js';
import { RUN_OUTPUT_METADATA_BYTES } from '../../../../ports/dispatch.js';
import { sha256 } from '../input-values.js';
export const BACKEND_REPLAY_BYTES=BACKEND_CLEANUP_BUCKETS.tombstone;
export const BACKEND_TOMBSTONE_JSON_BYTES=BACKEND_REPLAY_BYTES-512;
export interface BackendSettlementTombstone{
 readonly version:1;readonly organizationId:string;readonly workspaceId:string;readonly runId:string;readonly attemptId:string;
 readonly deletionId:string;readonly runVersion:number;readonly intentDigest:string;readonly closureDigest:string|null;
 readonly kind:'source'|'absence'|'unsent';readonly retainedPayloadBytes:number;readonly metadataBytes:number;
 readonly cleanupBytes:65536;readonly cleanupReplyDigest:string|null;readonly agentTombstoneDigest:string|null;
 readonly settlementRequestDigest:string|null;readonly refundedBytes:number;readonly chargedBytes:2560;
}
const ids=['organizationId','workspaceId','runId','attemptId','deletionId'] as const;
const hashes=['intentDigest'] as const;
const agentHashes=['cleanupReplyDigest','agentTombstoneDigest','settlementRequestDigest'] as const;
const fields=['version',...ids,'runVersion',...hashes,'closureDigest','kind','retainedPayloadBytes','metadataBytes','cleanupBytes',...agentHashes,'refundedBytes','chargedBytes'];
function requireValue(value:unknown):asserts value{if(!value)throw Error('Invalid backend settlement tombstone');}
function amount(value:unknown):number{requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);return value;}
function digest(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
/** Current remaining debt only. Finalization's previous credit is never refunded twice. */
export function backendSettlementCredit(input:{kind:'source'|'absence'|'unsent';retainedPayloadBytes:number;metadataBytes:number;cleanupBytes:number}):number{
 const payload=amount(input.retainedPayloadBytes);const metadata=amount(input.metadataBytes);
 requireValue(input.cleanupBytes===BACKEND_CLEANUP_CONTROL_BYTES);
 if(input.kind==='unsent')requireValue(payload===0&&metadata===0);
 else requireValue((input.kind==='source'||input.kind==='absence')&&metadata===RUN_OUTPUT_METADATA_BYTES);
 requireValue(payload<=Number.MAX_SAFE_INTEGER-metadata-BACKEND_CLEANUP_CONTROL_BYTES);
 return payload+metadata+BACKEND_CLEANUP_CONTROL_BYTES-BACKEND_REPLAY_BYTES;
}
function identities(row:Record<string,unknown>):void{
 for(const name of ids)requireValue(typeof row[name]==='string'&&validatePrimitive('uuid',row[name]).ok&&row[name]===row[name].toLowerCase());
 for(const name of hashes)requireValue(digest(row[name]));
 requireValue(row.kind==='unsent'?row.closureDigest===null:digest(row.closureDigest));
 for(const name of agentHashes)requireValue(row.kind==='unsent'?row[name]===null:digest(row[name]));
}
/** Closed scalar metadata; transaction guards must establish original facts separately. */
export function captureBackendTombstone(input:unknown):BackendSettlementTombstone{
 const copy:unknown=JSON.parse(encodeJson(input,BACKEND_TOMBSTONE_JSON_BYTES));
 requireValue(copy&&typeof copy==='object'&&!Array.isArray(copy));const row=copy as Record<string,unknown>;
 requireValue(Object.keys(row).length===fields.length&&fields.every(name=>Object.hasOwn(row,name)));
 requireValue(row.version===1&&row.chargedBytes===BACKEND_REPLAY_BYTES&&amount(row.runVersion)>0);
 identities(row);
 const value=row as unknown as BackendSettlementTombstone;
 requireValue(value.refundedBytes===backendSettlementCredit(value));
 return Object.freeze(value);
}
export function backendTombstoneDigest(input:unknown):string{
 return sha256('beetle-lab.backend-settlement-tombstone.v1\n'+encodeCanonicalJson(captureBackendTombstone(input),BACKEND_TOMBSTONE_JSON_BYTES));
}
