import {expect,it,vi} from 'vitest';
import {runtimeName} from '../../../../agent/src/backends/docker/index.js';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {removeStopped} from './native-state.js';
function fixture(){
 const binding={id:'a'.repeat(64),installationId:'11111111-1111-4111-8111-111111111111',attemptId:'33333333-3333-4333-8333-333333333333',generation:1 as const,imageId:'sha256:'+'b'.repeat(64)};
 const scope={installationId:binding.installationId,organizationId:'22222222-2222-4222-8222-222222222222',workspaceId:'44444444-4444-4444-8444-444444444444',attemptId:binding.attemptId,generation:1};
 const name=runtimeName(scope)+'-live';const labels={'dev.beetle.installation':binding.installationId,'dev.beetle.attempt':binding.attemptId,'dev.beetle.generation':'1'};
 const container={Id:binding.id,Image:binding.imageId,State:{Running:false,OOMKilled:false},Config:{Labels:labels},Mounts:[{Destination:'/beetle/live',Type:'volume',Name:name}]};
 const volume={Name:name,Driver:'local',Scope:'local',Options:{type:'tmpfs',device:'tmpfs',o:'rw,noexec,nosuid,nodev,size=131072,nr_inodes=4,uid=1000,gid=1000,mode=0700'},Labels:{...labels,
  'dev.beetle.purpose':'live-mailbox','dev.beetle.organization':scope.organizationId,'dev.beetle.workspace':scope.workspaceId,'dev.beetle.intent':'c'.repeat(64),'dev.beetle.spec':'d'.repeat(64)}};
 const request=vi.fn<DockerTransport['request']>(async input=>({ok:true,status:input.method==='DELETE'?204:200,body:input.path.includes('/volumes/')?volume:container}));
 return {binding,container,volume,request,transport:{request} satisfies DockerTransport};
}
it('removes only the reverified stopped container and bound ephemeral volume without forcing or refunding',async()=>{
 const f=fixture();expect(await removeStopped(f.transport,f.binding)).toMatchObject({force:false,storageRefund:false,fixtureCleanup:true});
 expect(f.request.mock.calls.filter(([request])=>request.method==='DELETE').map(([request])=>request.path)).toEqual([
  '/v1.47/containers/'+f.binding.id+'?force=false','/v1.47/volumes/'+f.volume.Name+'?force=false']);
});
it.each(['running','image','installation','attempt','generation','volume'] as const)('refuses changed %s ownership before any deletion',async kind=>{
 const f=fixture();if(kind==='running')f.container.State.Running=true;
 if(kind==='image')f.container.Image='sha256:'+'e'.repeat(64);
 if(kind==='installation')f.container.Config.Labels['dev.beetle.installation']='55555555-5555-4555-8555-555555555555';
 if(kind==='attempt')f.container.Config.Labels['dev.beetle.attempt']='55555555-5555-4555-8555-555555555555';
 if(kind==='generation')f.container.Config.Labels['dev.beetle.generation']='2';
 if(kind==='volume')f.volume.Labels['dev.beetle.purpose']='other';
 await expect(removeStopped(f.transport,f.binding)).rejects.toThrow();expect(f.request.mock.calls.some(([request])=>request.method==='DELETE')).toBe(false);
});
