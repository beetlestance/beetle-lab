import { it,expect } from 'vitest';
import { history,command,scope,uuid } from './selection-fixture.js';
import { custody,usage,otherWorkspace } from './fixture.js';
import { ManualRunDeletionSnapshots } from '../../src/adapters/outbound/sqlite/retention-manual/index.js';
import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { captureRetentionOperation,captureRetentionReply } from '../../src/adapters/outbound/sqlite/retention-wire/index.js';
function fixture(){
 const f=history(1);f.policy(values=>{values.retention={mode:'manual'};});const base=command(f);
 const row=f.db.prepare('SELECT id,version FROM runs LIMIT 1').get()!;
 const {page,...request}=base.request;void page;
 const input={...base,request:{...request,runId:String(row.id),expectedRunVersion:Number(row.version)}};
 return{...f,input,manual:new ManualRunDeletionSnapshots(f.db,f.reads)};
}
it('previews exactly one eligible Run under manual policy and admits through the shared atomic Apply',()=>{
 const f=fixture();try{
  const original=usage(f.db) as number;const page=f.manual.preview(f.input);expect(page.kind).toBe('manual');expect(page.candidates).toHaveLength(1);
  expect(page.candidates[0]).toMatchObject({id:f.input.request.runId,version:f.input.request.expectedRunVersion,reason:'manual'});
  expect(usage(f.db)).toBe(original+131584);expect(f.db.prepare('SELECT 1 FROM output_deletion_intents').get()).toBeUndefined();
  const apply={id:uuid(55000),appliedAt:'2026-11-14T12:01:00.000Z',request:{scope,requestId:uuid(55001),settingsId:page.settings.workspace.id,expectedVersion:page.settings.workspace.version,snapshotId:page.id,snapshotVersion:1,page:{limit:1}}};
  expect(new WorkspaceRetentionApplies(f.db,f.reads).apply(apply)).toMatchObject({state:'admitted',maximumCandidates:1});expect(usage(f.db)).toBe(original+131584);
 }finally{f.db.close();}
});
it('replays an immutable manual preview before changed policy and rejects request reuse for another Run',()=>{
 const f=fixture();try{
  const page=f.manual.preview(f.input);f.policy(values=>{values.retention={mode:'enabled',ageDays:1};});const stable=custody(f.db);
  expect(f.manual.preview({...f.input,id:uuid(55000)})).toEqual(page);
  expect(()=>f.manual.preview({...f.input,request:{...f.input.request,runId:uuid(55001)}})).toThrow('conflict');expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
it('refuses active, version-stale and cross-workspace Runs without funding a snapshot',()=>{
 const f=fixture();try{
  const target=otherWorkspace(f);const active=f.add(99);const stable=custody(f.db);
  expect(()=>f.manual.preview({...f.input,request:{...f.input.request,runId:active.runId,expectedRunVersion:1}})).toThrow();
  expect(()=>f.manual.preview({...f.input,request:{...f.input.request,expectedRunVersion:999}})).toThrow('conflict');
  expect(()=>f.manual.preview({...f.input,request:{...f.input.request,scope:target}})).toThrow('not_found');
  expect(f.db.prepare('SELECT 1 FROM retention_snapshots').get()).toBeUndefined();expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
it('refuses full quota and stale Apply without creating any deletion intent',()=>{
 const f=fixture();try{
  f.policy(values=>{values.pool.storageBytes=1;});expect(()=>f.manual.preview(f.input)).toThrow('capacity_unavailable');expect(f.db.prepare('SELECT 1 FROM retention_snapshots').get()).toBeUndefined();
  f.policy(values=>{values.pool.storageBytes=4_000_000;});const page=f.manual.preview(f.input);f.add(99);
  const apply={id:uuid(55000),appliedAt:'2026-11-14T12:01:00.000Z',request:{scope,requestId:uuid(55001),settingsId:page.settings.workspace.id,expectedVersion:page.settings.workspace.version,snapshotId:page.id,snapshotVersion:1,page:{limit:1}}};
  expect(()=>new WorkspaceRetentionApplies(f.db,f.reads).apply(apply)).toThrow('conflict');expect(f.db.prepare('SELECT 1 FROM output_deletion_intents').get()).toBeUndefined();
 }finally{f.db.close();}
});
it('binds both worker boundaries to the manual request, Run and version',()=>{
 const f=fixture();try{
  const op={kind:'previewRunDeletion' as const,command:f.input};expect(captureRetentionOperation({...op,messageId:1})).toEqual(op);const page=f.manual.preview(f.input);
  expect(captureRetentionReply(op,page)).toEqual(page);
  expect(()=>captureRetentionOperation({...op,command:{...f.input,request:{...f.input.request,extra:true}}})).toThrow();
  for(const candidate of [{...page.candidates[0],id:uuid(55000)},{...page.candidates[0],version:999}])expect(()=>captureRetentionReply(op,{...page,candidates:[candidate]})).toThrow();
 }finally{f.db.close();}
});
