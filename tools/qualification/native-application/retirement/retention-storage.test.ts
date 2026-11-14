import { it,expect } from 'vitest';
import { retainedSnapshotFunding,acknowledgedSnapshotFunding } from './retention-storage.js';
import { history,command,scope,uuid } from '../../../../app/test/retention/selection-fixture.js';
import { ManualRunDeletionSnapshots } from '../../../../app/src/adapters/outbound/sqlite/retention-manual/index.js';
import { WorkspaceRetentionApplies } from '../../../../app/src/adapters/outbound/sqlite/retention-apply/index.js';
import { RetentionProgress } from '../../../../app/src/adapters/outbound/sqlite/retention-progress/index.js';
it('independently verifies paid snapshot/epoch lifecycle and refuses absent scope or premature settlement claims',()=>{
 const f=history(1);try{
  const base=command(f);const {page,...request}=base.request;void page;const run=f.db.prepare('SELECT id,version FROM runs LIMIT 1').get()!;
  const snapshot=new ManualRunDeletionSnapshots(f.db,f.reads).preview({...base,request:{...request,runId:run.id,expectedRunVersion:run.version}});const key={scope,id:snapshot.id};
  expect(retainedSnapshotFunding(f.db,key,String(run.id),'preview').chargedBytes).toBe(131584);
  expect(()=>retainedSnapshotFunding(f.db,undefined,String(run.id),'preview')).toThrow();expect(()=>retainedSnapshotFunding(f.db,{...key,scope:{...scope,workspaceId:uuid(90000)}},String(run.id),'preview')).toThrow();
  const input={id:uuid(90001),appliedAt:'2026-11-14T12:01:00.000Z',request:{scope,requestId:uuid(90002),settingsId:snapshot.settings.workspace.id,expectedVersion:snapshot.settings.workspace.version,snapshotId:snapshot.id,snapshotVersion:1,page:{limit:1}}};
  new WorkspaceRetentionApplies(f.db,f.reads).apply(input);expect(()=>retainedSnapshotFunding(f.db,key,String(run.id),'settled')).toThrow();const member=snapshot.candidates[0]!;
  f.store.execute({kind:'settleBackendOutput',request:{key:{scope,id:member.deletionId,runId:member.id},agentReply:null}});expect(retainedSnapshotFunding(f.db,key,member.id,'settled').chargedBytes).toBe(131584);
  const progress=new RetentionProgress(f.db,f.reads);const now=Date.parse('2026-11-14T12:02:00.000Z');expect(progress.get(key,now).state).toBe('completed');progress.discard(key,now);
  expect(()=>acknowledgedSnapshotFunding(f.db,key,snapshot.epoch)).toThrow();expect(()=>acknowledgedSnapshotFunding(f.db,key,snapshot.epoch+2)).not.toThrow();
 }finally{f.db.close();}
});
