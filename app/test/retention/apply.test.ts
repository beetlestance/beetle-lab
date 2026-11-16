import { it,expect } from 'vitest';
import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { selected } from './apply-fixture.js';
import { command,scope,uuid } from './selection-fixture.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { otherWorkspace } from './fixture.js';
import { ready } from '../output-deletion/fixture.js';
import { WorkspaceRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-selection/index.js';
import { rows } from '../storage/clock-reason/fixtures.js';
import { usage } from './fixture.js';
const snapshot=(f:{db:Parameters<typeof rows>[0]})=>JSON.stringify(rows(f.db));
it('atomically admits every captured original without refund, then replays before stale/expiry checks',()=>{
 const f=selected();try{
  expect(f.page.candidates).toHaveLength(3);const before=usage(f.db);const receipt=f.apply.apply(f.input);
  expect(receipt).toMatchObject({state:'admitted',maximumCandidates:3,snapshotId:f.page.id});expect(usage(f.db)).toBe(before);
  expect(f.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(3);expect(f.db.prepare('SELECT count(*) n FROM retention_progress').get()?.n).toBe(3);
  expect(f.db.prepare('SELECT epoch FROM retention_workspace_epochs').get()?.epoch).toBe(f.page.epoch+3);
  f.policy(values=>{values.retention={mode:'manual'};values.pool.storageBytes=1;});
  expect(f.apply.apply({...f.input,id:uuid(50002),appliedAt:'2026-11-15T12:00:00.000Z'})).toEqual(receipt);
  expect(usage(f.db)).toBe(before);expect(f.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(3);
 }finally{f.db.close();}
});
it('refuses changed intent, stale epoch/settings and undersized membership without a partial Begin',()=>{
 const f=selected();try{
  expect(()=>f.apply.apply({...f.input,request:{...f.input.request,page:{limit:1}}})).toThrow();
  // Maintenance time is an independent commit; compare mutation data after that observation.
  const observed=snapshot(f);expect(f.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(0);
  expect(()=>f.apply.apply({...f.input,request:{...f.input.request,expectedVersion:2}})).toThrow();expect(snapshot(f)).toBe(observed);
  f.add(99);const changed=snapshot(f);expect(()=>f.apply.apply(f.input)).toThrow();expect(snapshot(f)).toBe(changed);
 }finally{f.db.close();}
});
it('rolls all prior child intents, receipts, epoch and progress back on a later child failure',()=>{
 const f=selected();try{
  const second=f.page.candidates[1]!;f.db.exec(`CREATE TRIGGER synthetic_apply_late BEFORE INSERT ON output_deletion_intents WHEN NEW.id='${second.deletionId}' BEGIN SELECT RAISE(ABORT,'synthetic child failure');END`);
  // Commit maintenance first, then preserve the exact transaction baseline.
  expect(()=>f.apply.apply(f.input)).toThrow();const observed=snapshot(f);expect(f.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(0);
  expect(()=>f.apply.apply(f.input)).toThrow();expect(snapshot(f)).toBe(observed);expect(f.db.prepare('SELECT epoch FROM retention_workspace_epochs').get()?.epoch).toBe(f.page.epoch);
  f.db.exec('DROP TRIGGER synthetic_apply_late');expect(f.apply.apply(f.input).maximumCandidates).toBe(3);
 }finally{f.db.close();}
});

it.each(['UPDATE settings SET version=version+1','DELETE FROM receipts','UPDATE installation_storage_usage SET charged_bytes=charged_bytes-1',
 'UPDATE retention_storage SET clock_ms=clock_ms+1','UPDATE retention_workspace_epochs SET epoch=epoch+1'])('denies nested writes outside the exact child phase: %s',sql=>{
 const f=selected();try{
  f.observe();f.db.exec(`CREATE TRIGGER synthetic_apply_nested AFTER INSERT ON output_deletion_intents BEGIN ${sql};END`);const before=snapshot(f);
  expect(()=>f.apply.apply(f.input)).toThrow();expect(snapshot(f)).toBe(before);
 }finally{f.db.close();}
});
it('denies a peer workspace epoch change and a raw SQLite sequence mutation',()=>{
 const f=selected();try{
  const target=otherWorkspace(f);const peer=f.proposal(80,target);f.reserve(peer);f.observe();
  f.db.exec(`CREATE TRIGGER synthetic_apply_peer AFTER INSERT ON output_deletion_intents BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1 WHERE workspace_id='${target.workspaceId}';END`);
  const before=snapshot(f);expect(()=>f.apply.apply(f.input)).toThrow();expect(snapshot(f)).toBe(before);f.db.exec('DROP TRIGGER synthetic_apply_peer');
  f.db.exec("CREATE TRIGGER synthetic_apply_sequence AFTER INSERT ON receipts BEGIN UPDATE sqlite_sequence SET seq=0 WHERE name='output_deletion_intents';END");
  const stable=snapshot(f);expect(()=>f.apply.apply(f.input)).toThrow();expect(snapshot(f)).toBe(stable);
 }finally{f.db.close();}
});
it('rolls every child and progress row back when final applied-state storage fails',()=>{
 const f=selected();try{
  f.observe();f.db.exec("CREATE TRIGGER synthetic_apply_state AFTER UPDATE ON retention_snapshots BEGIN SELECT RAISE(ABORT,'synthetic state failure');END");const before=snapshot(f);
  expect(()=>f.apply.apply(f.input)).toThrow();expect(snapshot(f)).toBe(before);f.db.exec('DROP TRIGGER synthetic_apply_state');
  expect(f.apply.apply(f.input).maximumCandidates).toBe(3);
 }finally{f.db.close();}
});
it('keeps live batch request identity distinct from other mutations and changed successful reuse',()=>{
 const f=selected();try{
  const receipt=f.apply.apply(f.input);const before=snapshot(f);
  expect(()=>f.apply.apply({...f.input,request:{...f.input.request,page:{limit:1}}})).toThrow('conflict');expect(snapshot(f)).toBe(before);
  const request={scope,requestId:receipt.requestId};expect(()=>f.store.execute({kind:'cancelRun',command:cancelCommand(f.page.candidates[0]!.id,request)})).toThrow();expect(snapshot(f)).toBe(before);
 }finally{f.db.close();}
});
it('uses the shared exact published-file representation for source-backed admission',()=>{
 const f=ready(2);f.policy(values=>{values.retention={mode:'enabled',ageDays:1};values.pool.storageBytes=2_000_000;});
 const page=new WorkspaceRetentionSnapshots(f.db,f.reads).preview(command(f));const before=f.usage();const request={scope,requestId:uuid(51000),settingsId:page.settings.workspace.id,expectedVersion:page.settings.workspace.version,
  snapshotId:page.id,snapshotVersion:1,page:{limit:1}};
 const receipt=new WorkspaceRetentionApplies(f.db,f.reads).apply({id:uuid(51001),appliedAt:'2026-11-14T12:01:00.000Z',request});
 expect(receipt.maximumCandidates).toBe(1);expect(f.usage()).toBe(before);expect(f.db.prepare('SELECT count(*) n FROM output_deletion_files').get()?.n).toBe(2);
 expect(JSON.parse(String(f.db.prepare('SELECT body_json FROM retention_progress').get()?.body_json))).toEqual({phase:'admitted',fileCount:2,preparedCount:0,absentCount:0,error:null});
});
it('admits the maximum hundred-member page inside the declared metadata allowance',()=>{
 const f=selected(100);try{
  const row=f.db.prepare('SELECT body_json FROM retention_snapshots').get();expect(Buffer.byteLength(String(row?.body_json))).toBeLessThanOrEqual(32768);
  const before=usage(f.db);expect(f.apply.apply(f.input).maximumCandidates).toBe(100);expect(usage(f.db)).toBe(before);
  expect(f.db.prepare('SELECT count(*) n FROM retention_progress').get()?.n).toBe(100);expect(f.db.prepare('SELECT max(length(CAST(body_json AS BLOB))) n FROM retention_progress').get()?.n).toBeLessThanOrEqual(256);
  expect(f.db.prepare('SELECT epoch FROM retention_workspace_epochs').get()?.epoch).toBe(f.page.epoch+100);
 }finally{f.db.close();}
});
