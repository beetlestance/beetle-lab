import { cancelCommand } from '../run-cancellation-fixtures.js';
import { command } from '../../output-deletion/fixture.js';
import { expect,it } from 'vitest';
import { claimsFixture,custody } from '../dispatch-claim-fixtures.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { reserveCleanupControl,requireCleanupControl } from '../../../src/adapters/outbound/sqlite/cleanup-control/index.js';
import { BACKEND_CLEANUP_CONTROL_BYTES,BACKEND_CLEANUP_BUCKETS } from '../../../src/ports/cleanup-control.js';
import { createInput } from '../inputs-fixture.js';
const capacity=()=>({allocationBytes:400000,reserveBytes:1000});
const original=(key:ReturnType<ReturnType<typeof claimsFixture>['add']>)=>({runId:key.runId,...key.attempt});
it('fits exact bucket and maximal compact file/ledger rows independently',()=>{
 expect(Object.values(BACKEND_CLEANUP_BUCKETS).reduce((a,b)=>a+b,0)).toBe(BACKEND_CLEANUP_CONTROL_BYTES);
 const u='ffffffff-ffff-4fff-8fff-ffffffffffff';const bytes=Buffer.byteLength(JSON.stringify([u,u,127,Number.MAX_SAFE_INTEGER,3,'f'.repeat(64),'f'.repeat(64),1]));
 expect(bytes).toBe(238);expect(bytes+128).toBeLessThanOrEqual(384);
 expect(Buffer.byteLength(JSON.stringify([u,u,u,u,1,65536,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]))+512).toBeLessThanOrEqual(BACKEND_CLEANUP_BUCKETS.ledger);
});
it('charges the same installation once and replays without current capacity or mutation',()=>{
 const f=claimsFixture();try{const key=original(f.add());const before=f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()!.charged_bytes as number;
  requireCleanupControl(f.db,key);transaction(f.db,()=>reserveCleanupControl(f.db,key,capacity));
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(before);
  const snapshot=custody(f.db);transaction(f.db,()=>reserveCleanupControl(f.db,key,()=>{throw Error('Replay must not inspect capacity');}));expect(custody(f.db)).toEqual(snapshot);
  for(const sql of ['UPDATE backend_cleanup_controls SET reserved_bytes=0','DELETE FROM backend_cleanup_controls','INSERT OR REPLACE INTO backend_cleanup_controls SELECT * FROM backend_cleanup_controls'])expect(()=>f.db.exec(sql)).toThrow();
 }finally{f.db.close();}
});
it('refuses enqueue at full shared capacity without partial rows or charges',()=>{
 const f=claimsFixture();try{const key=original(f.add());f.store.execute({kind:'input',command:createInput(888,400000-1000-2*65536)});
  const before=custody(f.db);expect(()=>f.add(71)).toThrow('capacity_unavailable');
  expect(()=>f.db.prepare(`INSERT INTO backend_cleanup_controls VALUES(?,?,?,?,1,65536,400000,1000)`).run(key.attemptId,key.runId,key.organizationId,key.workspaceId)).toThrow();
  expect(()=>f.db.prepare(`INSERT INTO backend_cleanup_controls VALUES(?,?,?,?,1,65536,9007199254740991,0)`).run(key.attemptId,key.runId,key.organizationId,key.workspaceId)).toThrow();
  expect(custody(f.db)).toEqual(before);expect(f.db.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(1);
 }finally{f.db.close();}
});
it('rolls output charges back on late claim failure while retaining original cleanup funding',()=>{
 const f=claimsFixture();try{const key=f.add();const before=custody(f.db);
  f.db.exec("CREATE TRIGGER fail_output AFTER INSERT ON attempt_output_allocations BEGIN SELECT RAISE(ABORT,'synthetic late control failure'); END");
  expect(()=>f.claims.claim(key)).toThrow();expect(custody(f.db)).toEqual(before);expect(f.db.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(1);
 }finally{f.db.close();}
});

it('reuses enqueue funding for positively unsent Begin without inventing output allocation or an agent ACK',()=>{
 const f=claimsFixture();try{const key=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(key.runId)});
  const input={kind:'beginOutputDeletion' as const,command:command({...f,key})};const before=Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes);
  const result=f.store.execute(input);expect(result).toMatchObject({kind:'unsent',metadataBytes:0});expect(f.store.execute(input)).toEqual(result);
  expect(Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes)).toBe(before);
  expect(f.db.prepare('SELECT count(*) n FROM attempt_output_allocations').get()?.n).toBe(0);
 }finally{f.db.close();}
});
