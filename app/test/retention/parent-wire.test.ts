import { it,expect } from 'vitest';
import { history,scope,uuid } from './selection-fixture.js';
import { parentCommand } from './parent-fixture.js';
import { storageFixture } from '../storage/fixture.js';
import { ParentRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-parent/index.js';
import { captureRetentionOperation,captureRetentionReply,retentionReplyLimit } from '../../src/adapters/outbound/sqlite/retention-wire/index.js';
const storage=storageFixture();
it('closes parent worker envelopes and binds durable scope, intent, pins and continuation context',()=>{
 const f=history(4);try{
  const command=parentCommand(f);const op={kind:'previewParentRetention' as const,command};const value=new ParentRetentionSnapshots(f.db,f.reads).preview(command);
  expect(captureRetentionOperation({...op,messageId:1})).toEqual(op);expect(retentionReplyLimit(op)).toBe(40960);expect(captureRetentionReply(op,value)).toEqual(value);
  const workspace=value.workspace!;for(const invalid of [{...value,durable:false},{...value,nextCursor:btoa(uuid(48000))},{...value,settingsVersion:99},
   {...value,workspace:{...workspace,intentDigest:'0'.repeat(64)}},{...value,workspace:{...workspace,traversal:{...workspace.traversal,previousSnapshotId:uuid(48001)}}},{...value,extra:true}])expect(()=>captureRetentionReply(op,invalid)).toThrow();
  expect(()=>captureRetentionOperation({...op,command:{...command,request:{...command.request,scope}}})).toThrow();
 }finally{f.db.close();}
});
it('recovers a committed parent preview reply through fresh compiled workers and atomically hands off its empty context',async()=>{
 const f=history(4);const input=parentCommand(f);const second=parentCommand(f,1);const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const initial=Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes);const installation=f.settings.chain(scope).installation;f.db.close();
 const options={runtime:null,runs:f.config,installation};const metadata=await storage.open(path,options);let committed!:()=>void;const issued=new Promise<void>(resolve=>{committed=resolve;});const receive=Reflect.get(metadata,'receive') as (value:unknown)=>void;
 Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'){const value=Reflect.get(message,'value');if(value&&typeof value==='object'&&Reflect.get(value,'coverage')==='live_partial'){committed();return;}}receive.call(metadata,message);
 });
 const outcome=metadata.retention.previewParent(input).then(()=>true,()=>false);await issued;await metadata.abort();expect(await outcome).toBe(false);
 const reopened=await storage.open(path,options);try{
  const first=await reopened.retention.previewParent({...input,id:uuid(48000)});expect(first.durable).toBe(true);expect(first.workspace?.after.completedCount).toBe(2);expect((await reopened.inputs.storage()).chargedBytes).toBe(initial+131584);
  const nextInput={...second,request:{...second.request,page:{...second.request.page,cursor:first.nextCursor!}}};const next=await reopened.retention.previewParent(nextInput);expect(next.workspace?.before.completedCount).toBe(2);expect(next.workspace?.after.completedCount).toBe(4);expect(next.nextCursor).toBeNull();
  expect((await reopened.inputs.storage()).chargedBytes).toBe(initial+131584);expect((await reopened.retention.list(scope)).items).toHaveLength(1);
  await expect(reopened.retention.getPreview({scope,id:first.workspace!.id})).rejects.toThrow('not_found');
  expect(await reopened.retention.previewParent({...nextInput,id:uuid(48001)})).toEqual(next);
 }finally{await storage.close(reopened);}
});
