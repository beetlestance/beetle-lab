import {encodeCanonicalJson} from '@beetle/contracts';
import {validateApi} from '@beetle/contracts/api';
import type {OutputDeletionSummary,OutputDeletionFile,OutputDeletionFileKey,OutputDeletionPage} from '../../ports/output-deletion-metadata.js';
function safe(value:unknown):asserts value{if(!value)throw Error('Invalid deletion progress');}
function copy<T>(value:T,maximum:number):T{return JSON.parse(encodeCanonicalJson(value,maximum)) as T;}
function count(value:unknown):asserts value is number{safe(Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=128);}
export function deletionPage(input:OutputDeletionPage):OutputDeletionPage{
 const page=copy(input,8192);safe(Array.isArray(page.items)&&page.items.length<=1);
 safe(page.nextCursor===null||typeof page.nextCursor==='string'&&page.nextCursor.length<=512);
 if(page.nextCursor!==null)safe(page.items.length===1);
 for(const item of page.items)summary(item);
 return page;
}
function summary(item:OutputDeletionSummary):void{
 safe(validateApi('WorkspaceScope',item.scope).ok&&validateApi('Uuid',item.id).ok&&validateApi('Uuid',item.runId).ok);
 safe(item.stage==='pending'&&item.deletionVersion===1);count(item.fileCount);count(item.absentCount);
 safe(item.fileCount>0&&item.absentCount<item.fileCount);
}
export function deletionFile(input:OutputDeletionFile,key:OutputDeletionFileKey):OutputDeletionFile{
 const file=copy(input,8192);const binding=file.record.binding;
 safe(file.deletionId===key.id&&file.deletionVersion===1&&file.record.artifact.ordinal===key.ordinal);
 safe(binding.key.runId===key.runId&&binding.key.attempt.organizationId===key.scope.organizationId&&binding.key.attempt.workspaceId===key.scope.workspaceId);
 const phases={pending_preparation:1,prepared:2,absent:3};safe(Object.hasOwn(phases,file.phase)&&file.version===phases[file.phase]);
 if(file.phase==='pending_preparation')safe(file.namespaceIdentity===null&&file.preparationIdentity===null);
 else for(const value of [file.namespaceIdentity,file.preparationIdentity])safe(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
 return file;
}

export function retirementPage(input:OutputDeletionPage):OutputDeletionPage{
 const page=copy(input,65536);safe(Array.isArray(page.items)&&page.items.length<=32);
 safe(page.nextCursor===null||typeof page.nextCursor==='string'&&page.nextCursor.length<=256);
 const ids=new Set<string>();
 for(const item of page.items){
  safe(validateApi('WorkspaceScope',item.scope).ok&&validateApi('Uuid',item.id).ok&&validateApi('Uuid',item.runId).ok);
  retirementSummary(item);
  count(item.fileCount);count(item.absentCount);safe(item.absentCount===item.fileCount&&!ids.has(item.id));ids.add(item.id);
 }
 return page;
}
/** Only this explicit known refusal is a safe capacity deferral. */
export function capacityRefusal(error:unknown):boolean{
 if(typeof error!=='object'||error===null)return false;
 return Object.getOwnPropertyDescriptor(error,'code')?.value==='capacity_unavailable';
}
export function sameDeletion(actual:OutputDeletionSummary,expected:OutputDeletionSummary):void{
 for(const key of ['id','runId','kind','fileCount','deletionVersion'] as const)safe(actual[key]===expected[key]);
 safe(encodeCanonicalJson(actual.scope,512)===encodeCanonicalJson(expected.scope,512));
}

function retirementSummary(item:OutputDeletionSummary):void{
 safe(item.stage==='files_absent'&&item.deletionVersion===1&&(item.kind==='source'||item.kind==='absence'));
}
