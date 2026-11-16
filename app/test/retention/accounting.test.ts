import { it,expect } from 'vitest';
import { fixture,now,custody,scope,usage } from './fixture.js';
it('preps actual epoch+snapshot debt once, then replays without current capacity or settings',()=>{
 const f=fixture();try{
  const input=f.proposal();const before=Number(usage(f.db));const stored=f.reserve(input);
  expect(usage(f.db)).toBe(before+131072+512);expect(f.db.prepare('SELECT * FROM retention_storage').get()).toMatchObject({epoch_count:1,snapshot_count:1,charged_bytes:131584,clock_ms:now});
  f.policy(values=>{values.pool.storageBytes=1;values.retention={mode:'enabled',ageDays:30};});
  const snapshot=custody(f.db);expect(f.reserve({...input,id:f.proposal(3).id})).toEqual(stored);expect(custody(f.db)).toEqual(snapshot);
 }finally{f.db.close();}
});
it('keeps eight bounded prepaid pages and refuses saturation without eviction',()=>{
 const f=fixture();try{
  for(let i=0;i<8;i++)f.reserve(f.proposal(i));const before=custody(f.db);
  expect(()=>f.reserve(f.proposal(8))).toThrow('capacity_unavailable');expect(custody(f.db)).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM retention_snapshots').get()?.n).toBe(8);expect(usage(f.db)).toBe(8*131072+512);
 }finally{f.db.close();}
});
it('refuses actual quota shortage and rolls permanent epoch/all counters back on late failure',()=>{
 const f=fixture();try{
  f.policy(values=>{values.pool.storageBytes=131584;values.pool.freeSpaceReserveBytes=1;});const before=custody(f.db);
  expect(()=>f.reserve()).toThrow('capacity_unavailable');expect(custody(f.db)).toEqual(before);
  f.policy(values=>{values.pool.storageBytes=2_000_000;});
  f.db.exec("CREATE TRIGGER retention_synthetic_late AFTER UPDATE ON retention_storage BEGIN SELECT RAISE(ABORT,'synthetic late failure');END");const stable=custody(f.db);
  expect(()=>f.reserve()).toThrow();expect(custody(f.db)).toEqual(stable);expect(f.db.prepare('SELECT count(*) n FROM retention_workspace_epochs').get()?.n).toBe(0);
 }finally{f.db.close();}
});
it('refuses clock rollback, stale actual settings, changed epoch and cross-scope policy pins',()=>{
 const f=fixture();try{
  const first=f.proposal();f.reserve(first);const candidate=f.proposal(1);let before=custody(f.db);
  expect(()=>f.reserve(candidate,now-1)).toThrow();expect(custody(f.db)).toEqual(before);
  f.add();before=custody(f.db);expect(()=>f.reserve(candidate)).toThrow('conflict');expect(custody(f.db)).toEqual(before);
  const current=f.proposal(2);f.db.prepare("UPDATE settings SET version=version+1 WHERE scope_key='installation'").run();before=custody(f.db);
  expect(()=>f.reserve(current)).toThrow('conflict');expect(custody(f.db)).toEqual(before);
  const wrong=f.proposal(3);expect(()=>f.reserve({...wrong,policySource:{kind:'organization',organizationId:scope.organizationId}})).toThrow();
 }finally{f.db.close();}
});
it('denies raw replacement/refund and nested cross-owner writes during the private reservation',()=>{
 const f=fixture();try{
  f.reserve();for(const sql of ['DELETE FROM retention_workspace_epochs','UPDATE retention_workspace_epochs SET epoch=0','DELETE FROM retention_snapshots','INSERT OR REPLACE INTO retention_snapshots SELECT * FROM retention_snapshots','UPDATE retention_storage SET charged_bytes=0,snapshot_count=0,epoch_count=0'])expect(()=>f.db.exec(sql)).toThrow();
  f.db.exec('CREATE TRIGGER retention_nested AFTER INSERT ON retention_snapshots BEGIN DELETE FROM receipts;END');const before=custody(f.db);
  expect(()=>f.reserve(f.proposal(1))).toThrow();expect(custody(f.db)).toEqual(before);
 }finally{f.db.close();}
});
