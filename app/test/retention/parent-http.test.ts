import { it,expect } from 'vitest';
import { history,scope,uuid } from './selection-fixture.js';
import { parentCommand } from './parent-fixture.js';
import { storageFixture } from '../storage/fixture.js';
import { http,client,headers } from './http-fixture.js';
const storage=storageFixture();const params={organizationId:scope.organizationId,workspaceId:scope.workspaceId};
it('recovers a dropped parent preview over real TCP, then admits its workspace only through explicit workspace Apply',async()=>{
 const f=history(3);f.policy(value=>{value.retention={mode:'enabled',ageDays:1};});const input=parentCommand(f);const second=parentCommand(f,1);const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const installation=f.settings.chain(scope).installation;f.db.close();
 const options={runtime:null,runs:f.config,installation};const metadata=await storage.open(path,options);const server=http(metadata,'parent');const api=await client(server);
 expect((await api.previewInstallationRetention({body:input.request})).ok).toBe(false);await server.close();await storage.close(metadata);
 const fresh=await storage.open(path,options);const reopened=http(fresh);const next=await client(reopened);try{
  const result=await next.previewInstallationRetention({body:input.request});expect(result.ok).toBe(true);if(!result.ok||!result.value.workspace)throw Error('Parent preview failed');const parent=result.value;const preview=parent.workspace!;
  expect(parent.coverage).toBe('live_partial');expect(parent.durable).toBe(true);expect(parent.nextCursor).not.toBeNull();expect(preview.candidates).toHaveLength(2);expect(preview.scope).toEqual(scope);expect(preview.nextCursor).toBeNull();
  const recovered=await next.getWorkspaceRetentionPreview({params:{...params,snapshotId:preview.snapshotId}});expect(recovered.ok&&recovered.value.nextCursor).toBeNull();
  const body={scope,requestId:uuid(49000),settingsId:preview.settingsId,expectedVersion:preview.settingsVersion,snapshotId:preview.snapshotId,snapshotVersion:preview.version,page:{limit:preview.candidates.length}};
  expect((await next.applyWorkspaceRetention({params,body})).ok).toBe(true);const refused=await next.previewInstallationRetention({body:{...second.request,page:{limit:2,cursor:parent.nextCursor!}}});expect(refused.ok).toBe(false);
  const key={...params,snapshotId:preview.snapshotId};const progress=await next.getWorkspaceRetentionStatus({params:key});expect(progress.ok).toBe(true);if(!progress.ok)throw Error('Status failed');
  for(const item of progress.value.items)await fresh.outputSettlements.settle({key:{scope,id:item.deletionId,runId:item.runId},agentReply:null});
  const done=await next.getWorkspaceRetentionStatus({params:key});expect(done.ok&&done.value.refundedLogicalBytes).toBe(2*62976);expect((await next.discardWorkspaceRetention({params:key})).ok).toBe(true);expect((await fresh.inputs.storage()).chargedBytes).toBe(65536+2*2560+512);
 }finally{await reopened.close();await storage.close(fresh);}
});
it('requires authorization before parent parsing and exact installation/organization route scope',async()=>{
 const f=history(0);const input=parentCommand(f);const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const installation=f.settings.chain(scope).installation;f.db.close();
 const metadata=await storage.open(path,{runtime:null,runs:f.config,installation});const server=http(metadata);try{
  expect((await server.inject({method:'POST',url:'/api/v2/settings/retention-preview',payload:{bad:true}})).statusCode).toBe(401);
  expect((await server.inject({method:'POST',url:'/api/v2/settings/retention-preview',headers,payload:{...input.request,scope}})).statusCode).toBe(404);
  expect((await server.inject({method:'POST',url:`/api/v2/organizations/${scope.organizationId}/settings/retention-preview`,headers,payload:input.request})).statusCode).toBe(404);
  expect((await metadata.retention.list(scope)).items).toEqual([]);
 }finally{await server.close();await storage.close(metadata);}
});
