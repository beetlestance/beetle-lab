import { it,expect } from 'vitest';
import { storageFixture } from '../storage/fixture.js';
import { history,command,scope,uuid } from './selection-fixture.js';
import { otherWorkspace } from './fixture.js';
import { http,client,headers } from './http-fixture.js';
import { registerRetentionRoutes } from '../../src/adapters/inbound/http/retention/index.js';
const storage=storageFixture();const params={organizationId:scope.organizationId,workspaceId:scope.workspaceId};
const path=`/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}`;
function fixture(){
 const f=history(3);f.policy(values=>{values.retention={mode:'enabled',ageDays:1};});const input=command(f);const other=otherWorkspace(f);const file=storage.path();f.db.prepare('VACUUM INTO ?').run(file);const installation=f.settings.chain(scope).installation;f.db.close();return{...f,input,other,file,installation};
}
it('recovers a lost real TCP Apply response through fresh workers and reports settled credit then explicit acknowledgement',async()=>{
 const f=fixture();const options={runtime:null,runs:f.config,installation:f.installation};const metadata=await storage.open(f.file,options);const server=http(metadata,true);const api=await client(server);
 const preview=await api.previewWorkspaceRetention({params,body:f.input.request});expect(preview.ok).toBe(true);if(!preview.ok)throw Error('Preview failed');
 expect(preview.value.candidates).toHaveLength(3);expect(JSON.stringify(preview.value)).not.toContain('intentDigest');expect(JSON.stringify(preview.value)).not.toContain('deletionId');
 const snapshotId=preview.value.snapshotId;const apply={scope,requestId:uuid(66000),settingsId:preview.value.settingsId,expectedVersion:preview.value.settingsVersion,snapshotId,snapshotVersion:1,page:{limit:3}};
 expect((await api.applyWorkspaceRetention({params,body:apply})).ok).toBe(false);await server.close();await storage.close(metadata);
 const fresh=await storage.open(f.file,options);const reopened=http(fresh);const next=await client(reopened);const receipt=await next.applyWorkspaceRetention({params,body:apply});expect(receipt.ok).toBe(true);
 const listed=await next.listWorkspaceRetention({params});expect(listed.ok&&listed.value.items[0]?.state).toBe('applied');
 const key={...params,snapshotId};const recovered=await next.getWorkspaceRetentionPreview({params:key});expect(recovered.ok&&recovered.value).toEqual(preview.value);const status=await next.getWorkspaceRetentionStatus({params:key});expect(status.ok).toBe(true);if(!status.ok)throw Error('Status failed');expect(status.value.completedCount).toBe(0);expect(status.value.driverState).toBe('disabled');
 const refused=await next.discardWorkspaceRetention({params:key});expect(refused.ok).toBe(false);
 for(const item of status.value.items)await fresh.outputSettlements.settle({key:{scope,id:item.deletionId,runId:item.runId},agentReply:null});
 const done=await next.getWorkspaceRetentionStatus({params:key});expect(done.ok&&done.value.state).toBe('completed');expect(done.ok&&done.value.refundedLogicalBytes).toBe(3*(65536-2560));
 expect((await next.discardWorkspaceRetention({params:key})).ok).toBe(true);expect((await next.getWorkspaceRetentionStatus({params:key})).ok).toBe(false);
 expect((await next.discardWorkspaceRetention({params:key})).ok).toBe(false);expect((await next.applyWorkspaceRetention({params,body:apply})).ok).toBe(false);
 expect((await fresh.inputs.storage()).chargedBytes).toBe(3*2560+512);await reopened.close();await storage.close(fresh);
});
it('guards authentication before parsing and rejects route/body/Run identity changes without admission',async()=>{
 const f=fixture();const metadata=await storage.open(f.file,{runtime:null,runs:f.config,installation:f.installation});const server=http(metadata);
 expect((await server.inject({method:'POST',url:path+'/settings/retention-preview',payload:{bad:true}})).statusCode).toBe(401);
 expect((await server.inject({method:'POST',url:path+'/settings/retention-preview',headers,payload:{...f.input.request,scope:f.other}})).statusCode).toBe(404);
 const manual={...f.input.request,runId:uuid(70),expectedRunVersion:2};const {page,...request}=manual;void page;
 const result=await server.inject({method:'POST',url:path+'/runs/'+uuid(70)+'/deletion-preview',headers,payload:request});expect(result.statusCode).toBe(200);expect(result.json().kind).toBe('manual');
 expect((await server.inject({method:'POST',url:path+'/runs/'+uuid(71)+'/deletion-preview',headers,payload:request})).statusCode).toBe(404);
 const listed=await metadata.retention.list(scope);expect(listed.items).toHaveLength(1);
 expect((await server.inject({url:`/api/v2/organizations/${f.other.organizationId}/workspaces/${f.other.workspaceId}/retention-batches/${listed.items[0]!.id}`,headers})).statusCode).toBe(404);
 expect(()=>registerRetentionRoutes(server,{store:metadata.retention,newId:()=>uuid(99),now:()=>'',authorize:undefined!})).toThrow('authorization');
 await server.close();await storage.close(metadata);
});
