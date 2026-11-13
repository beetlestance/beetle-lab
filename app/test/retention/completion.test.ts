import { encodeCanonicalJson } from '@beetle/contracts';
import { captureBackendTombstone,backendTombstoneDigest } from '../../src/adapters/outbound/sqlite/settlement-values/index.js';
import { it,expect } from 'vitest';
import { selected } from './apply-fixture.js';
import { RetentionProgress } from '../../src/adapters/outbound/sqlite/retention-progress/index.js';
import { pruneRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-accounting/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { rows } from '../storage/clock-reason/fixtures.js';
import { scope } from './fixture.js';
function completed(){
 const f=selected();f.apply.apply(f.input);const reader=new RetentionProgress(f.db,f.reads);const key={scope,id:f.page.id};
 for(const member of f.page.candidates)f.store.execute({kind:'settleBackendOutput',request:{key:{scope,id:member.deletionId,runId:member.id},agentReply:null}});
 const now=Date.parse('2026-11-14T12:02:00.000Z');const status=reader.get(key,now);return{...f,reader,key,now,status};
}
it('retains completion and replay for the full observed window, then removes only paid page/progress debt',()=>{
 const f=completed();try{
  expect(f.status.state).toBe('completed');expect(f.status.completedAt).toBe('2026-11-14T12:02:00.000Z');
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,f.now+899999)).removed).toBe(0);
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,f.now+900000))).toMatchObject({removed:1,refundedBytes:131072});
  expect(f.db.prepare('SELECT count(*) n FROM retention_progress').get()?.n).toBe(0);expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3*2560+512);
  expect(f.db.prepare('SELECT * FROM retention_storage').get()).toMatchObject({snapshot_count:0,epoch_count:1,charged_bytes:512});
  expect(()=>f.apply.apply({...f.input,appliedAt:'2026-11-14T12:18:00.000Z'})).toThrow('not_found');
 }finally{f.db.close();}
});
it('permits explicit completed acknowledgement but never discards pending/unknown work',()=>{
 const f=selected();try{
  const reader=new RetentionProgress(f.db,f.reads);const key={scope,id:f.page.id};f.apply.apply(f.input);
  expect(()=>reader.discard(key,Date.parse(f.input.appliedAt))).toThrow('conflict');expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);
  for(const member of f.page.candidates)f.store.execute({kind:'settleBackendOutput',request:{key:{scope,id:member.deletionId,runId:member.id},agentReply:null}});
  reader.get(key,Date.parse(f.input.appliedAt));expect(reader.discard(key,Date.parse(f.input.appliedAt)).refundedLogicalBytes).toBe(131072);
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3*2560+512);
 }finally{f.db.close();}
});
it('keeps every row and charge when completed-page removal fails after progress deletion',()=>{
 const f=completed();try{
  f.db.exec("CREATE TRIGGER synthetic_completed_delete AFTER DELETE ON retention_progress BEGIN SELECT RAISE(ABORT,'synthetic progress close failure');END");const before=JSON.stringify(rows(f.db));
  expect(()=>transaction(f.db,()=>pruneRetentionSnapshots(f.db,f.now+900000))).toThrow();expect(JSON.stringify(rows(f.db))).toBe(before);
  f.db.exec('DROP TRIGGER synthetic_completed_delete');expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,f.now+900000)).removed).toBe(1);
 }finally{f.db.close();}
});
it('never accepts stored phase text or malformed/missing progress as permanent completion evidence',()=>{
 const f=selected();try{
  f.apply.apply(f.input);const reader=new RetentionProgress(f.db,f.reads);const key={scope,id:f.page.id};
  const sql=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='retention_progress_update'").get()?.sql;expect(typeof sql).toBe('string');f.db.exec('DROP TRIGGER retention_progress_update');
  f.db.exec("UPDATE retention_progress SET body_json=json_set(body_json,'$.phase','settled')");f.db.exec(String(sql));
  const status=reader.get(key,Date.parse('2026-11-14T12:03:00.000Z'));expect(status.state).toBe('applied');expect(status.completedCount).toBe(0);expect(status.items.every(item=>item.phase==='blocked')).toBe(true);
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,Date.parse('2026-11-15T12:00:00.000Z'))).removed).toBe(0);
 }finally{f.db.close();}
});

it('requires the permanent tombstone Run version, not merely a matching Run ID or a completed flag',()=>{
 const f=completed();try{
  const member=f.page.candidates[0]!;const row=f.db.prepare('SELECT tombstone_json FROM backend_retired_runs WHERE run_id=?').get(member.id);
  if(typeof row?.tombstone_json!=='string')throw Error('Missing synthetic tombstone');const original=captureBackendTombstone(JSON.parse(row.tombstone_json));
  const altered=captureBackendTombstone({...original,runVersion:original.runVersion+1});const guard=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='backend_retired_update'").get()?.sql;
  // Quiescent synthetic conflicting-proof fixture, restoring the exact immutable-row guard.
  f.db.exec('DROP TRIGGER backend_retired_update');f.db.prepare('UPDATE backend_retired_runs SET tombstone_json=?,tombstone_digest=? WHERE run_id=?')
   .run(encodeCanonicalJson(altered,2048),backendTombstoneDigest(altered),member.id);f.db.exec(String(guard));
  expect(()=>f.reader.get(f.key,f.now+900000)).toThrow('unavailable');
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,f.now+900000)).removed).toBe(0);
  expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(1);expect(()=>f.reader.discard(f.key,f.now+900000)).toThrow('conflict');
 }finally{f.db.close();}
});
it('rolls completion observation back if its closed frame attempts another owner write',()=>{
 const f=selected();try{
  f.apply.apply(f.input);for(const member of f.page.candidates)f.store.execute({kind:'settleBackendOutput',request:{key:{scope,id:member.deletionId,runId:member.id},agentReply:null}});
  f.db.exec('CREATE TRIGGER synthetic_complete_owner AFTER UPDATE ON retention_snapshots BEGIN UPDATE settings SET version=version+1;END');
  const before=JSON.stringify(rows(f.db));const reader=new RetentionProgress(f.db,f.reads);const now=Date.parse('2026-11-14T12:02:00.000Z');
  expect(()=>reader.get({scope,id:f.page.id},now)).toThrow();expect(JSON.stringify(rows(f.db))).toBe(before);
  f.db.exec('DROP TRIGGER synthetic_complete_owner');expect(reader.get({scope,id:f.page.id},now).state).toBe('completed');
 }finally{f.db.close();}
});
