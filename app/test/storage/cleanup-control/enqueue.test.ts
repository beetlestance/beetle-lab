import { expect,it } from 'vitest';
import { claimsFixture,custody } from '../dispatch-claim-fixtures.js';
import { runCommand,runRequest } from '../runs-fixture.js';
import { uuid } from '../fixture.js';
import { cancelCommand } from '../run-cancellation-fixtures.js';
import { command } from '../../output-deletion/fixture.js';

it('funds enqueue once and admits the actual claim at the exact remaining storage boundary',()=>{
 const f=claimsFixture(133172);try{
  const key=f.add();
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(65536);
  expect(f.claims.claim(key)).toMatchObject({kind:'claimed'});
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(131172);
  expect(f.db.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(1);
 }finally{f.db.close();}
});
it('rolls enqueue, pins and receipt back after a cleanup insert failure and allows a later retry',()=>{
 const f=claimsFixture();try{
  const before=custody(f.db);const request=runRequest(uuid(60));const create=runCommand(uuid(60),70,request);
  f.db.exec("CREATE TRIGGER fail_enqueue AFTER INSERT ON backend_cleanup_controls BEGIN SELECT RAISE(ABORT,'synthetic enqueue failure'); END");
  expect(()=>f.store.execute({kind:'run',command:create})).toThrow();expect(custody(f.db)).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT * FROM receipts WHERE request_id=?').get(request.requestId)).toBeUndefined();
  f.db.exec('DROP TRIGGER fail_enqueue');const result=f.store.execute({kind:'run',command:create});
  f.policy(values=>{values.pool.storageBytes=1000;});
  expect(f.store.execute({kind:'run',command:create})).toEqual(result);
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(65536);
 }finally{f.db.close();}
});
it('prepares unsent deletion at full capacity using its original reservation',()=>{
 const f=claimsFixture(66536);try{
  const key=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(key.runId)});
  expect(f.store.execute({kind:'beginOutputDeletion',command:command({...f,key})})).toMatchObject({kind:'unsent'});
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(65536);
  expect(f.db.prepare('SELECT count(*) n FROM attempt_output_allocations').get()?.n).toBe(0);
 }finally{f.db.close();}
});
