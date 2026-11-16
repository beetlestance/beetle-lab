import { it,expect } from 'vitest';
import { history,command,scope,uuid,previewCursor } from './selection-fixture.js';
import { custody,usage,otherWorkspace } from './fixture.js';
import { ready,begin } from '../output-deletion/fixture.js';
import { WorkspaceRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-selection/index.js';
it('continues past eight empty pages with stored prefixes and only one charged slot',()=>{
 const f=history();try{
  let previous:string|undefined;let final;
  for(let turn=0;turn<11;turn++){
   const page=f.retention.preview(command(f,turn,2,previous));expect(page.before.completedCount).toBe(turn*2);
   expect(page.after.completedCount).toBe(Math.min(21,(turn+1)*2));expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);
   if(turn<10){expect(page.candidates).toEqual([]);expect(page.hasMore).toBe(true);}previous=previewCursor(page.id);final=page;
  }
  expect(final?.candidates).toHaveLength(1);expect(final?.candidates[0]?.reason).toBe('completed_count');expect(final?.hasMore).toBe(false);
  expect(usage(f.db)).toBe(21*65536+131072+512);
 }finally{f.db.close();}
});
it('keeps immutable replay before current settings/epoch checks and rejects changed request content',()=>{
 const f=history(1);try{
  const input=command(f);const page=f.retention.preview(input);f.policy(values=>{values.retention={mode:'manual'};values.pool.storageBytes=1;});
  const stable=custody(f.db);expect(f.retention.preview({...input,id:uuid(9000)})).toEqual(page);expect(custody(f.db)).toEqual(stable);
  expect(()=>f.retention.preview({...input,request:{...input.request,page:{limit:1}}})).toThrow('conflict');expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
it('rejects a stale continuation without consuming its stored page or charging another',()=>{
 const f=history();try{
  const first=f.retention.preview(command(f,0,2));f.add(99);const stable=custody(f.db);
  expect(()=>f.retention.preview(command(f,1,2,previewCursor(first.id)))).toThrow('conflict');expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
it('never accepts another workspace cursor or exposes its immutable membership',()=>{
 const f=history();try{
  const first=f.retention.preview(command(f,0,2));const target=otherWorkspace(f);const stable=custody(f.db);
  expect(()=>f.retention.preview(command(f,1,2,previewCursor(first.id),target))).toThrow('not_found');expect(custody(f.db)).toEqual(stable);
  expect(()=>f.retention.preview(command(f,2,2,'Zm9yZ2Vk'))).toThrow();expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
it('selects only positively finalised source debt and protects committed cleanup',()=>{
 const f=ready(0);f.policy(values=>{values.retention={mode:'enabled',ageDays:1};values.pool.storageBytes=2_000_000;});
 const retention=new WorkspaceRetentionSnapshots(f.db,f.reads);const page=retention.preview(command(f));
 expect(page.candidates).toHaveLength(1);expect(page.candidates[0]?.id).toBe(f.key.runId);expect(page.candidates[0]?.estimatedBytes).toBe(f.usage()-131584);
 begin(f);const next=retention.preview(command(f,1));expect(next.candidates).toEqual([]);expect(next.exclusions).toMatchObject([{reason:'cleanup_in_progress',count:1}]);
});
it('treats a missing terminal proof as unknown bytes instead of a reclaimable result',()=>{
 const f=ready(0);f.policy(values=>{values.retention={mode:'enabled',ageDays:1,storageBytes:1};});
 const sql=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='finalization_retained'").get()?.sql;
 expect(typeof sql).toBe('string');f.db.exec('DROP TRIGGER finalization_retained');f.db.exec('DELETE FROM execution_output_finalizations');f.db.exec(String(sql));
 const page=new WorkspaceRetentionSnapshots(f.db,f.reads).preview(command(f));expect(page.candidates).toEqual([]);
 expect(page.exclusions).toEqual([{reason:'unknown',count:1,estimatedBytes:null}]);expect(page.after.logicalBytes).toBeNull();
});
it('uses the scoped requested-time index with a bounded keyset window',()=>{
 const f=history(1);try{
  const plan=f.db.prepare('EXPLAIN QUERY PLAN SELECT id,version,state,outcome,requested_at FROM runs INDEXED BY runs_overview_recent WHERE organization_id=? AND workspace_id=? AND (requested_at,id)<(?,?) ORDER BY requested_at DESC,id DESC LIMIT ?')
   .all(scope.organizationId,scope.workspaceId,'2026-11-14T12:00:00.000Z',uuid(9999),101);
  expect(JSON.stringify(plan)).toContain('runs_overview_recent');expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
 }finally{f.db.close();}
});
it('replays the committed child after its empty predecessor is consumed and reply is lost',()=>{
 const f=history();try{
  const first=f.retention.preview(command(f,0,2));const input=command(f,1,2,previewCursor(first.id));const child=f.retention.preview(input);
  expect(f.db.prepare('SELECT 1 FROM retention_snapshots WHERE id=?').get(first.id)).toBeUndefined();
  const before=usage(f.db);const replay=f.retention.preview({...input,id:uuid(9001),capturedAt:'2026-11-14T12:01:00.000Z'});
  expect(replay).toEqual(child);expect(usage(f.db)).toBe(before);expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);
 }finally{f.db.close();}
});
it('rolls empty-page handoff back when the replacement cannot fit the current quota',()=>{
 const f=history();try{
  const first=f.retention.preview(command(f,0,2));f.policy(values=>{values.pool.storageBytes=1;});const stable=custody(f.db);
  expect(()=>f.retention.preview(command(f,1,2,previewCursor(first.id)))).toThrow('capacity_unavailable');expect(custody(f.db)).toEqual(stable);
  expect(f.db.prepare('SELECT id FROM retention_snapshots').get()?.id).toBe(first.id);
 }finally{f.db.close();}
});
