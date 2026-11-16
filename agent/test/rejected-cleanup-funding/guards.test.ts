import { expect,it,vi } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { fundRejectedIntent,rejectedCandidate } from '../../src/journal/rejected-controls/guard.js';
import { transaction } from '../../src/journal/sql.js';
import { fundingFixture } from './fixtures.js';
const f=fundingFixture();
it('refuses raw control/counter forgery and preserves original quota after funding',async()=>{
 const v=await f.native();const facts=transaction(v.db,()=>rejectedCandidate(v.db,v.request));
 const insert=v.db.prepare(`INSERT INTO rejected_cleanup_controls VALUES(?,?,?,?,16384)`);
 expect(()=>insert.run(v.key.attemptId,facts.control.requestDigest,facts.control.namespaceIdentity,encodeCanonicalJson(facts.control,1024))).toThrow();
 expect(()=>v.db.exec('UPDATE rejected_cleanup_storage SET original_count=1,charged_bytes=16384')).toThrow();
 transaction(v.db,()=>fundRejectedIntent(v.db,v.request));
 expect(()=>v.db.prepare('UPDATE accepted_attempts SET quota_bytes=1024 WHERE attempt_id=?').run(v.key.attemptId)).toThrow();
 expect(()=>v.db.prepare('DELETE FROM rejected_cleanup_controls WHERE attempt_id=?').run(v.key.attemptId)).toThrow();
 expect(()=>v.db.prepare('UPDATE rejected_cleanup_controls SET charged_bytes=16384 WHERE attempt_id=?').run(v.key.attemptId)).toThrow();
 expect(()=>v.db.prepare('INSERT OR REPLACE INTO output_retirement_intents SELECT * FROM output_retirement_intents WHERE attempt_id=?').run(v.key.attemptId)).toThrow();
});
it.each(['global','original','counter'] as const)('rolls back a nested %s write and releases the private funding frame',async kind=>{
 const v=await f.native();const sql=kind==='global'?"UPDATE admission_settings SET observation_json=NULL WHERE id=1;":
  kind==='original'?"UPDATE accepted_attempts SET cancel_requested=cancel_requested;":
  "UPDATE rejected_cleanup_storage SET original_count=original_count+1,charged_bytes=charged_bytes+16384 WHERE id=1;";
 v.db.exec(`CREATE TRIGGER synthetic_nested AFTER INSERT ON rejected_cleanup_controls BEGIN ${sql} END;`);
 expect(()=>transaction(v.db,()=>fundRejectedIntent(v.db,v.request))).toThrow();
 expect(v.db.prepare('SELECT original_count FROM rejected_cleanup_storage').get()?.original_count).toBe(0);
 expect(v.db.prepare('SELECT count(*) n FROM output_retirement_intents').get()?.n).toBe(0);
 expect(v.db.prepare('SELECT count(*) n FROM rejected_cleanup_controls').get()?.n).toBe(0);
 v.db.exec('DROP TRIGGER synthetic_nested');transaction(v.db,()=>fundRejectedIntent(v.db,v.request));
 expect(v.db.prepare('SELECT original_count FROM rejected_cleanup_storage').get()?.original_count).toBe(1);
});

it('records funding time atomically, refusing a later new original after rollback while preserving exact replay',async()=>{
 const v=await f.native('cancel',true);const actual=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(actual);
 try{
  transaction(v.db,()=>fundRejectedIntent(v.db,v.request));clock.mockReturnValue(actual-1);
  expect(()=>transaction(v.db,()=>fundRejectedIntent(v.db,v.secondRequest))).toThrow('recovery_required');
  expect(transaction(v.db,()=>fundRejectedIntent(v.db,v.request))).toMatchObject({request:v.request});
  expect(v.db.prepare('SELECT original_count,last_clock FROM rejected_cleanup_storage').get()).toMatchObject({original_count:1,last_clock:actual});
 }finally{clock.mockRestore();}
});
