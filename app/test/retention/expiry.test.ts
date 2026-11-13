import { it,expect } from 'vitest';
import { fixture,now,custody,usage } from './fixture.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { pruneRetentionSnapshots } from '../../src/adapters/outbound/sqlite/retention-accounting/index.js';
const expired=now+900000;
it('expires all eight owned preview pages once and keeps permanent epoch charge/identity',()=>{
 const f=fixture();try{
  for(let i=0;i<8;i++)f.reserve(f.proposal(i));
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired-1))).toEqual({removed:0,refundedBytes:0,observedAtMs:expired-1});
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired))).toEqual({removed:8,refundedBytes:8*131072,observedAtMs:expired});
  expect(usage(f.db)).toBe(512);expect(f.db.prepare('SELECT epoch FROM retention_workspace_epochs').get()?.epoch).toBe(1);
  const stable=custody(f.db);expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired))).toMatchObject({removed:0,refundedBytes:0});expect(custody(f.db)).toEqual(stable);
  expect(f.db.prepare('SELECT * FROM retention_storage').get()).toMatchObject({epoch_count:1,snapshot_count:0,charged_bytes:512,clock_ms:expired});
 }finally{f.db.close();}
});
it('preserves every applied page after expiry regardless of missing/stale progress',()=>{
 const f=fixture();try{
  const stored=f.reserve();const guard=f.db.prepare("SELECT sql FROM sqlite_master WHERE name='retention_snapshot_update'").get()?.sql;
  // Explicit synthetic applied-header fixture; no native completion/refund is invented.
  expect(typeof guard).toBe('string');f.db.exec('DROP TRIGGER retention_snapshot_update');
  f.db.prepare("UPDATE retention_snapshots SET state='applied',apply_json='{}' WHERE id=?").run(stored.id);f.db.exec(String(guard));
  expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired))).toMatchObject({removed:0,refundedBytes:0});expect(usage(f.db)).toBe(131584);
  expect(f.db.prepare('SELECT state FROM retention_snapshots WHERE id=?').get(stored.id)?.state).toBe('applied');
 }finally{f.db.close();}
});
it('rolls expiry and its exact credit back after actual counter failure; retry keeps one epoch',()=>{
 const f=fixture();try{
  f.reserve();f.db.exec("CREATE TRIGGER synthetic_expiry_failure AFTER UPDATE ON installation_storage_usage BEGIN SELECT RAISE(ABORT,'synthetic late credit failure');END");const stable=custody(f.db);
  expect(()=>transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired))).toThrow();expect(custody(f.db)).toEqual(stable);
  f.db.exec('DROP TRIGGER synthetic_expiry_failure');expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired)).refundedBytes).toBe(131072);expect(usage(f.db)).toBe(512);
 }finally{f.db.close();}
});
it('retains observed expiry time across clock rollback instead of resurrecting a page',()=>{
 const f=fixture();try{
  const stored=f.reserve();transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired));
  const stable=custody(f.db);expect(transaction(f.db,()=>pruneRetentionSnapshots(f.db,now))).toMatchObject({removed:0,observedAtMs:expired});
  expect(()=>f.reserve(stored,now)).toThrow('conflict');expect(custody(f.db)).toEqual(stable);
  expect(()=>transaction(f.db,()=>pruneRetentionSnapshots(f.db,Date.parse('+010000-01-01T00:00:00.000Z')))).toThrow();expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
it('denies nested deletion/refund of another page during exact preview expiry',()=>{
 const f=fixture();try{
  f.reserve();const other=f.reserve(f.proposal(1));
  f.db.exec(`CREATE TRIGGER synthetic_nested_expiry AFTER DELETE ON retention_snapshots BEGIN DELETE FROM retention_snapshots WHERE id='${other.id}';END`);const stable=custody(f.db);
  expect(()=>transaction(f.db,()=>pruneRetentionSnapshots(f.db,expired))).toThrow();expect(custody(f.db)).toEqual(stable);
 }finally{f.db.close();}
});
