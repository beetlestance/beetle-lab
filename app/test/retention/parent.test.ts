import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { command as workspaceCommand } from './selection-fixture.js';
import { it,expect } from 'vitest';
import { history,scope,uuid } from './selection-fixture.js';
import { otherWorkspace,usage } from './fixture.js';
import { command as namespaceCommand } from '../storage/fixture.js';
import { ParentRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-parent/index.js';
import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { parentCommand as command } from './parent-fixture.js';
it('continues trusted Run prefixes then resets at the next workspace without combining budgets',()=>{
 const f=history(4);try{
  const other=otherWorkspace(f);f.policy(value=>{value.retention={mode:'enabled',completedRunCount:2};});const parent=new ParentRetentionSnapshots(f.db,f.reads);
  const first=parent.preview(command(f));expect(first.workspace?.candidates).toHaveLength(0);expect(first.workspace?.after.completedCount).toBe(2);expect(first.nextCursor).not.toBeNull();
  const next=parent.preview(command(f,1,first.nextCursor!));expect(next.workspace?.before.completedCount).toBe(2);expect(next.workspace?.candidates).toHaveLength(2);expect(next.nextCursor).not.toBeNull();
  expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);
  const last=parent.preview(command(f,2,next.nextCursor!));expect(last.workspace?.scope).toEqual(other);expect(last.workspace?.before).toEqual({completedCount:0,logicalBytes:0});expect(last.workspace?.scanned).toBe(0);expect(last.nextCursor).toBeNull();expect(last.coverage).toBe('live_partial');
  expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(2);expect(usage(f.db)).toBe(4*65536+2*131072+2*512);
 }finally{f.db.close();}
});
it('transfers one funded empty slot across more than eight workspace contexts',()=>{
 const f=history(0);try{
  f.policy(value=>{value.retention={mode:'manual'};});for(let i=0;i<10;i++)f.store.execute({kind:'namespace',command:namespaceCommand({kind:'createWorkspace',id:uuid(20000+i),rootFolderId:uuid(21000+i),request:{scope:{kind:'organization',organizationId:scope.organizationId},requestId:uuid(22000+i),name:'Synthetic bounded workspace '+i}})});
  const parent=new ParentRetentionSnapshots(f.db,f.reads);let cursor:string|undefined;const visited=new Set<string>();
  for(let i=0;i<11;i++){const result=parent.preview(command(f,i,cursor));expect(result.durable).toBe(true);expect(result.workspace?.scanned).toBe(0);visited.add(result.workspace!.scope.workspaceId);expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);cursor=result.nextCursor??undefined;}
  expect(cursor).toBeUndefined();expect(visited.size).toBe(11);expect(usage(f.db)).toBe(131072+11*512);
 }finally{f.db.close();}
});
it('replays committed context before changed settings/quota and refuses changed parent intent',()=>{
 const f=history(4);try{
  const parent=new ParentRetentionSnapshots(f.db,f.reads);const input=command(f);const first=parent.preview(input);f.policy(value=>{value.retention={mode:'manual'};value.pool.storageBytes=1;});const before=usage(f.db);
  expect(parent.preview({...input,id:uuid(43000)})).toEqual(first);expect(usage(f.db)).toBe(before);
  expect(()=>parent.preview({...input,request:{...input.request,page:{limit:1}}})).toThrow('conflict');
 }finally{f.db.close();}
});
it('rejects stale epochs and another parent scope cursor without consuming prior context',()=>{
 const f=history(4);try{
  const parent=new ParentRetentionSnapshots(f.db,f.reads);const first=parent.preview(command(f));const before=usage(f.db);
  expect(()=>parent.preview(command(f,1,first.nextCursor!,{kind:'organization',organizationId:scope.organizationId}))).toThrow('not_found');
  f.add(99);const original=f.db.prepare('SELECT body_json FROM retention_snapshots').get()?.body_json;
  expect(()=>parent.preview(command(f,2,first.nextCursor!))).toThrow('conflict');expect(f.db.prepare('SELECT body_json FROM retention_snapshots').get()?.body_json).toBe(original);expect(usage(f.db)).toBe(Number(before)+65536);
 }finally{f.db.close();}
});
it('rolls empty-context handoff back when replacement funding fails',()=>{
 const f=history(4);try{
  const parent=new ParentRetentionSnapshots(f.db,f.reads);const first=parent.preview(command(f));f.policy(value=>{value.pool.storageBytes=1;});const before=JSON.stringify(f.db.prepare('SELECT * FROM retention_snapshots').all());const amount=usage(f.db);
  expect(()=>parent.preview(command(f,1,first.nextCursor!))).toThrow('capacity_unavailable');expect(JSON.stringify(f.db.prepare('SELECT * FROM retention_snapshots').all())).toBe(before);expect(usage(f.db)).toBe(amount);
 }finally{f.db.close();}
});
it('invalidates parent continuation after successful explicit workspace Apply',()=>{
 const f=history(4);try{
  f.policy(value=>{value.retention={mode:'enabled',ageDays:1};});const parent=new ParentRetentionSnapshots(f.db,f.reads);const first=parent.preview(command(f));const page=first.workspace!;
  new WorkspaceRetentionApplies(f.db,f.reads).apply({id:uuid(44000),appliedAt:'2026-11-14T12:01:00.000Z',request:{scope,requestId:uuid(44001),settingsId:page.settings.workspace.id,expectedVersion:page.settings.workspace.version,snapshotId:page.id,snapshotVersion:1,page:{limit:2}}});
  expect(()=>parent.preview({...command(f,1,first.nextCursor!),capturedAt:'2026-11-14T12:01:00.000Z'})).toThrow('conflict');
 }finally{f.db.close();}
});
it('returns a deliberately non-durable empty organization result without an unfunded parent row',()=>{
 const f=history(0);try{
  const id=uuid(31);f.store.execute({kind:'namespace',command:namespaceCommand({kind:'createOrganization',id,request:{scope:{kind:'installation'},requestId:uuid(45000),name:'Empty traversal',slug:'empty-traversal'}})});
  const before=usage(f.db);const result=new ParentRetentionSnapshots(f.db,f.reads).preview(command(f,0,undefined,{kind:'organization',organizationId:id}));expect(result).toMatchObject({durable:false,workspace:null,nextCursor:null,coverage:'live_partial'});expect(usage(f.db)).toBe(before);expect(f.db.prepare('SELECT 1 FROM retention_snapshots').get()).toBeUndefined();
 }finally{f.db.close();}
});

it('keeps completed-run budgets independent for two populated workspaces',()=>{
 const f=history(1);try{
  f.policy(value=>{value.retention={mode:'enabled',completedRunCount:1};});const other=f.addOther();const owner={kind:'workspace' as const,organizationId:other.attempt.organizationId,workspaceId:other.attempt.workspaceId};
  f.store.execute({kind:'cancelRun',command:cancelCommand(other.runId,{scope:owner,requestId:uuid(46000)})});const parent=new ParentRetentionSnapshots(f.db,f.reads);
  const first=parent.preview(command(f));const next=parent.preview(command(f,1,first.nextCursor!));expect(first.workspace?.candidates).toEqual([]);expect(next.workspace?.candidates).toEqual([]);expect(next.workspace?.after.completedCount).toBe(1);expect(next.nextCursor).toBeNull();
 }finally{f.db.close();}
});
it('labels live partial coverage when a workspace is inserted behind the captured cursor',()=>{
 const f=history(0);try{
  otherWorkspace(f);const parent=new ParentRetentionSnapshots(f.db,f.reads);const first=parent.preview(command(f));
  f.store.execute({kind:'namespace',command:namespaceCommand({kind:'createWorkspace',id:uuid(1),rootFolderId:uuid(47000),request:{scope:{kind:'organization',organizationId:scope.organizationId},requestId:uuid(47001),name:'Inserted behind traversal'}})});
  const next=parent.preview(command(f,1,first.nextCursor!));expect(next.workspace?.scope.organizationId).not.toBe(scope.organizationId);expect(next.nextCursor).toBeNull();expect(next.coverage).toBe('live_partial');
  expect(parent.preview(command(f,2)).workspace?.scope.workspaceId).toBe(uuid(1));
 }finally{f.db.close();}
});
it('refuses interpreting a parent traversal cursor as an ordinary workspace continuation',()=>{
 const f=history(4);try{
  const page=new ParentRetentionSnapshots(f.db,f.reads).preview(command(f));const before=usage(f.db);
  expect(()=>f.retention.preview(workspaceCommand(f,20,2,page.nextCursor!))).toThrow('conflict');expect(usage(f.db)).toBe(before);
 }finally{f.db.close();}
});
