import { it,expect } from 'vitest';
import { selected } from './apply-fixture.js';
import { RetentionProgress } from '../../src/adapters/outbound/sqlite/retention-progress/index.js';
import { ready,file,plan } from '../output-deletion/fixture.js';
import { cleaned } from '../output-deletion/cleanup-ack/fixture.js';
import { WorkspaceRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-selection/index.js';
import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { command,scope,uuid } from './selection-fixture.js';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
const clock=Date.parse('2026-11-14T12:02:00.000Z');
it('reports preview/admitted work without credit and completes only exact durable original settlements',()=>{
 const f=selected();try{
  const reader=new RetentionProgress(f.db,f.reads);const key={id:f.page.id,scope};
  expect(reader.get(key,clock).items.every(item=>item.phase==='preview')).toBe(true);
  f.apply.apply({...f.input,appliedAt:'2026-11-14T12:03:00.000Z'});const pending=reader.get(key,clock+120000);
  expect(pending.state).toBe('applied');expect(pending.completedCount).toBe(0);expect(pending.refundedLogicalBytes).toBe(0);expect(pending.items.every(item=>item.phase==='settling')).toBe(true);
  for(const member of f.page.candidates)f.store.execute({kind:'settleBackendOutput',request:{key:{scope,id:member.deletionId,runId:member.id},agentReply:null}});
  const finished=reader.get(key,clock+180000);expect(finished.state).toBe('completed');expect(finished.completedCount).toBe(3);expect(finished.refundedLogicalBytes).toBe(3*(65536-2560));
  expect(finished.completedAt).toBe('2026-11-14T12:05:00.000Z');expect(finished.items.every(item=>item.phase==='settled')).toBe(true);
  expect(reader.get(key,clock+240000).completedAt).toBe(finished.completedAt);
  expect(f.apply.apply({...f.input,appliedAt:'2026-11-14T12:17:00.000Z'}).state).toBe('admitted');
 }finally{f.db.close();}
});
it('reports partial settlement honestly and keeps the batch pending',()=>{
 const f=selected();try{
  f.apply.apply(f.input);const member=f.page.candidates[0]!;f.store.execute({kind:'settleBackendOutput',request:{key:{scope,id:member.deletionId,runId:member.id},agentReply:null}});
  const result=new RetentionProgress(f.db,f.reads).get({scope,id:f.page.id},clock);expect(result.state).toBe('applied');expect(result.completedCount).toBe(1);expect(result.completedAt).toBeNull();
  expect(result.refundedLogicalBytes).toBe(65536-2560);expect(f.db.prepare('SELECT completed_at FROM retention_snapshots').get()?.completed_at).toBeNull();
 }finally{f.db.close();}
});
it('derives file counts, agent cleanup and settling from actual stored plans/receipts',()=>{
 const f=ready(2);f.policy(values=>{values.retention={mode:'enabled',ageDays:1};values.pool.storageBytes=2_000_000;});
 const page=new WorkspaceRetentionSnapshots(f.db,f.reads).preview(command(f));const member=page.candidates[0]!;
 new WorkspaceRetentionApplies(f.db,f.reads).apply({id:uuid(52000),appliedAt:'2026-11-14T12:01:00.000Z',request:{scope,requestId:uuid(52001),settingsId:page.settings.workspace.id,expectedVersion:page.settings.workspace.version,snapshotId:page.id,snapshotVersion:1,page:{limit:1}}});
 const reader=new RetentionProgress(f.db,f.reads);const key={scope,id:page.id};const deletion={scope,id:member.deletionId,runId:member.id};
 expect(reader.get(key,clock).items[0]).toMatchObject({phase:'backend_files',preparedCount:0,absentCount:0,fileCount:2});
 for(let ordinal=0;ordinal<2;ordinal++){
  const native=plan(file(f,deletion,ordinal));const fileKey={...deletion,ordinal};f.store.execute({kind:'recordOutputDeletionPlan',request:{key:fileKey,expectedVersion:1,plan:native}});
  f.store.execute({kind:'recordOutputDeletionAbsence',request:{key:fileKey,expectedVersion:2,receipt:{...native,phase:'absent'}}});
 }
 expect(reader.get(key,clock).items[0]).toMatchObject({phase:'agent_cleanup',preparedCount:2,absentCount:2,fileCount:2});
 const request=f.store.execute({kind:'getOutputRetirementRequest',key:deletion}) as RetirementRequest;f.store.execute({kind:'recordOutputCleanupAck',request:{key:deletion,reply:cleaned(request)}});
 expect(reader.get(key,clock).items[0]?.phase).toBe('settling');expect(reader.get(key,clock).completedCount).toBe(0);
});
