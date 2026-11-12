import {encodeJson,encodeCanonicalJson} from '@beetle/contracts';
import {validateApi} from '@beetle/contracts/api';
import type {ExportJob,ExportJobPage} from '@beetle/contracts/api';
import type {ExportStore,ExportKey,ExportList,CreateExportOperation,CancelExportOperation} from '../../ports/exports.js';
import type {IntentDigest} from '../namespaces/index.js';
import {requireRule,sameScope,sameUuid} from '../../domain/namespaces/index.js';
import {prepareExportCommand,prepareExportCancellation} from './intent.js';
function job(input:unknown,key:ExportKey):ExportJob {
 const result=validateApi('ExportJob',JSON.parse(encodeJson(input,32768)));requireRule(result.ok);
 requireRule(sameScope(result.value.scope,key.scope)&&sameUuid(result.value.id,key.id),'not_found');return result.value;
}
export async function createExport(operation:CreateExportOperation,digest:IntentDigest,store:ExportStore):Promise<ExportJob>{
 const command=prepareExportCommand(operation,digest);const value=await store.create(command);
 // Replay is tied to request intent, never this call's fresh generated ID or time.
 const checked=job(value,{scope:command.request.scope,id:value.id});const request=command.request;
 requireRule(sameUuid(checked.revisionId,request.revisionId)&&checked.sourceProfileId===request.engineProfile);
 const fields=(v:Pick<ExportJob,'budget'|'executionPolicy'|'options'>)=>({budget:v.budget,executionPolicy:v.executionPolicy,options:v.options});
 requireRule(encodeCanonicalJson(fields(checked),4096)===encodeCanonicalJson(fields(request),4096));
 requireRule(checked.version===1&&checked.state==='queued'&&!checked.cancellationRequested&&checked.reason===null);return checked;
}
export async function cancelExport(operation:CancelExportOperation,digest:IntentDigest,store:ExportStore):Promise<ExportJob>{
 const command=prepareExportCancellation(operation,digest);const value=job(await store.cancel(command),{scope:command.request.scope,id:command.id});
 requireRule(value.cancellationRequested||['ready','failed','cancelled'].includes(value.state));return value;
}
export async function getExport(key:ExportKey,store:ExportStore):Promise<ExportJob>{return job(await store.get(key),key);}
export async function listExports(query:ExportList,store:ExportStore):Promise<ExportJobPage>{
 const result=validateApi('ExportJobPage',JSON.parse(encodeJson(await store.list(query),262144)));requireRule(result.ok);
 requireRule(sameScope(result.value.scope,query.scope)&&result.value.items.length<=query.limit);
 const ids=new Set<string>();for(const item of result.value.items){job(item,{scope:query.scope,id:item.id});requireRule(!ids.has(item.id));ids.add(item.id);}
 return result.value;
}
