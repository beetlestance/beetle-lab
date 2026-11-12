import {vi} from 'vitest';
import {record,id,deferred} from '../files/output-bytes/fixture.js';
import type {OutputDeletionFile,OutputDeletionSummary} from '../../src/ports/output-deletion-metadata.js';
import type {OutputDeletionStore} from '../../src/ports/output-deletion.js';
import type {OutputDeletionRuntimeOptions} from '../../src/application/output-deletion-runtime/index.js';
import {startOutputDeletionRuntime} from '../../src/application/output-deletion-runtime/index.js';
export {deferred};
export function fixture(){
 const base=record();const r={...base,artifact:{...base.artifact,phase:'published' as const,offset:base.artifact.bytes,writer:null,identity:'a'.repeat(64)}};
 const scope={kind:'workspace' as const,organizationId:id(1),workspaceId:id(2)};
 const summary:OutputDeletionSummary={id:id(10),scope,requestId:id(11),runId:id(3),runVersion:2,deletionVersion:1,version:1,kind:'source',stage:'pending',fileCount:1,preparedCount:0,absentCount:0,retainedPayloadBytes:100,metadataBytes:65536,requestedAt:'2026-01-01T00:00:00Z'};
 let file:OutputDeletionFile={deletionId:summary.id,deletionVersion:1,record:r,version:1,phase:'pending_preparation',namespaceIdentity:null,preparationIdentity:null};
 const plan={record:r,deletionId:summary.id,deletionVersion:1,namespaceIdentity:'b'.repeat(64),preparationIdentity:'c'.repeat(64)};
 const metadata={scan:vi.fn<NonNullable<OutputDeletionRuntimeOptions['metadata']>['scan']>(async()=>({items:file.phase==='absent'?[]:[summary],nextCursor:null})),
  getFile:vi.fn(async()=>structuredClone(file)),recordPlan:vi.fn(async()=>{file={...file,version:2,phase:'prepared',namespaceIdentity:plan.namespaceIdentity,preparationIdentity:plan.preparationIdentity};return structuredClone(file);}),
  recordAbsence:vi.fn(async()=>{file={...file,version:3,phase:'absent'};return structuredClone(file);})};
 const files={prepareRemoval:vi.fn<OutputDeletionStore['prepareRemoval']>(()=>({result:Promise.resolve(structuredClone(plan)),settled:Promise.resolve()})),
  remove:vi.fn<OutputDeletionStore['remove']>(()=>({result:Promise.resolve({...structuredClone(plan),phase:'absent' as const}),settled:Promise.resolve()}))};
 const onFailure=vi.fn(async()=>{});const options:OutputDeletionRuntimeOptions={metadata,files,freeSpaceReserveBytes:0,intervalMs:25,onFailure};
 return {summary,plan,metadata,files,onFailure,options,current:()=>file,start:()=>startOutputDeletionRuntime(options)};
}
