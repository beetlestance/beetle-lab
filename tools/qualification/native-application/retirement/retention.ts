import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ApiClient,Run,RetentionPreview } from '@beetle/contracts/api';
import type { Metadata } from '../../../../app/src/adapters/outbound/sqlite/index.js';
import { value,pause } from '../public-api.js';
import { acknowledgedSnapshotFunding } from './retention-storage.js';
import type { RetentionKey } from './retention-storage.js';
import { record } from './metadata.js';
/** Actual public preview; wait only on bounded authoritative reads, never synthesize eligibility. */
export async function previewRetention(api:ApiClient,run:Run){
 const scope=run.scope;const params={organizationId:scope.organizationId,workspaceId:scope.workspaceId};let known=false;
 for(let turn=0;turn<32;turn++){
  const history=value(await api.listRuns({params,query:{limit:100}}));if(history.summaries.some(item=>item.runId===run.id&&item.retainedLogicalBytes!==null)){known=true;break;}await pause();
 }
 assert(known,'Run logical debt never became authoritative');const settings=value(await api.getWorkspaceSettings({params}));
 const preview=value(await api.previewRunDeletion({params:{...params,runId:run.id},body:{scope,runId:run.id,expectedRunVersion:run.version,requestId:randomUUID(),settingsId:settings.id,expectedVersion:settings.version}}));
 assert.equal(preview.kind,'manual');assert.equal(preview.candidates.length,1);assert.equal(preview.candidates[0]!.id,run.id);assert.equal(preview.candidates[0]!.version,run.version);
 const status=value(await api.getWorkspaceRetentionStatus({params:{...params,snapshotId:preview.snapshotId}}));assert.equal(status.driverState,'running');assert.equal(status.state,'preview');assert.equal(status.refundedLogicalBytes,0);
 return{preview,status,key:{scope,id:preview.snapshotId}};
}
/** Actual compiled worker Apply with the stored child identity and prepaid reservation. */
export async function applyRetention(metadata:Metadata,run:Run,preview:RetentionPreview){
 const scope=run.scope;const snapshot=await metadata.retention.getPreview({scope,id:preview.snapshotId});assert.equal(snapshot.kind,'manual');assert.equal(snapshot.candidates.length,1);const member=snapshot.candidates[0]!;assert.equal(member.id,run.id);
 const command={id:randomUUID(),appliedAt:new Date().toISOString(),request:{scope,requestId:randomUUID(),settingsId:preview.settingsId,expectedVersion:preview.settingsVersion,snapshotId:preview.snapshotId,snapshotVersion:1,page:{limit:1}}};
 const before=(await metadata.inputs.storage()).chargedBytes;const receipt=await metadata.retention.apply(command);assert.equal((await metadata.inputs.storage()).chargedBytes,before);
 const key={scope,id:member.deletionId,runId:run.id};const intent=await metadata.outputDeletions.get(key);assert.equal(intent.requestId,member.requestId);assert(intent.fileCount>0);
 return{command,receipt,key,snapshot};
}
export async function completeRetention(metadata:Metadata,path:string,key:RetentionKey,applied:Awaited<ReturnType<typeof applyRetention>>,refundedBytes:number){
 const status=await metadata.retention.get(key,Date.now());assert.equal(status.state,'completed');assert.equal(status.completedCount,1);assert.equal(status.refundedLogicalBytes,refundedBytes);
 assert.deepEqual(await metadata.retention.apply(applied.command),applied.receipt);assert.equal((await metadata.inputs.storage()).chargedBytes,134144);
 const discarded=await metadata.retention.discard(key,Date.now());assert.equal(discarded.refundedLogicalBytes,131072);assert.equal((await metadata.inputs.storage()).chargedBytes,3072);
 await assert.rejects(metadata.retention.apply(applied.command),error=>record(error)?.code==='not_found');await assert.rejects(metadata.retention.discard(key,Date.now()),error=>record(error)?.code==='not_found');
 await metadata.close();const db=new DatabaseSync(path,{readOnly:true});try{acknowledgedSnapshotFunding(db,key,applied.snapshot.epoch+2);}finally{db.close();}
 return{status,discarded,permanentEpochBytes:512,finalBackendBytes:3072};
}
