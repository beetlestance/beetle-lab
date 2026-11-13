import {JOURNAL_SCHEMA_VERSION} from '../../src/journal/schema.js';
import { expect,it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { initialize } from '../../src/journal/schema.js';
import { cleanupControl,nativeCleanupReceiptIdentity } from '../../src/cleanup-control/index.js';
import { nativeAbsenceFacts } from '../../src/native-removal/index.js';
import { fixture } from './fixtures.js';
import { asSchema19 } from './legacy.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
const retained=['accepted_attempts','reservations','disk_holds','disk_retention_stats','event_spool','output_retirement_intents','output_cleanup_plans','output_cleanup_progress'] as const;
it('migrates actual schema19, retaining all prior rows/rootpages/charges while adding one exact receipt',async()=>{
 const e=await f.completed();const observed=await e.removal.stepWithProofAndPorts(e.token,operation(),e.ports);if(!observed.absence)throw Error('Missing actual native proof');
 const facts=nativeAbsenceFacts(observed.absence,{retirements:e.owner.retirements,plans:e.owner.cleanupPlans,progress:e.owner.cleanupProgress,receipts:e.owner.cleanupReceipts});
 await e.owner.close();let db=initialize(e.journalPath);asSchema19(db);const rows=Object.fromEntries(retained.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
 const schema=db.prepare("SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();db.close();
 const journal=await f.open(e.journalPath);const stored=await journal.cleanupReceipts.commit(e.plan,facts.receipt);await journal.close();db=initialize(e.journalPath);
 try{expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(JOURNAL_SCHEMA_VERSION);for(const table of retained)expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(rows[table]);
  for(const row of schema)expect(db.prepare('SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name=?').get(String(row.name))).toEqual(row);
  const json=encodeCanonicalJson(facts.receipt,cleanupControl.receiptBytes);expect(db.prepare('SELECT receipt_identity,encoded_bytes,charged_bytes FROM output_cleanup_receipts').get()).toEqual({receipt_identity:stored.receiptIdentity,encoded_bytes:Buffer.byteLength(json),charged_bytes:Buffer.byteLength(json)+512});
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('raw SQL rejects wrong receipt identity/closure, replacement/update/delete and charge changes',async()=>{
 const e=await f.completed();const observed=await e.removal.stepWithProofAndPorts(e.token,operation(),e.ports);if(!observed.absence)throw Error('Missing proof');
 const receipt=nativeAbsenceFacts(observed.absence,{retirements:e.owner.retirements,plans:e.owner.cleanupPlans,progress:e.owner.cleanupProgress,receipts:e.owner.cleanupReceipts}).receipt;
 await e.owner.close();const db=initialize(e.journalPath);const json=encodeCanonicalJson(receipt,cleanupControl.receiptBytes);const bytes=Buffer.byteLength(json);const identity=nativeCleanupReceiptIdentity(receipt);
 const insert=(verb='INSERT',digest=identity,body=json,charge=bytes+512)=>db.prepare(`${verb} INTO output_cleanup_receipts(attempt_id,plan_identity,receipt_identity,receipt_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?,?,?)`).run(e.key.attemptId,receipt.planIdentity,digest,body,Buffer.byteLength(body),charge);
 try{
  expect(()=>insert('INSERT','f'.repeat(64))).toThrow('invalid cleanup receipt initial');const bad=encodeCanonicalJson({...receipt,closure:'unproven'},cleanupControl.receiptBytes);expect(()=>insert('INSERT',identity,bad,Buffer.byteLength(bad)+512)).toThrow('invalid cleanup receipt initial');
  expect(()=>insert('INSERT',identity,json,0)).toThrow();insert();expect(()=>insert('INSERT OR REPLACE')).toThrow('invalid cleanup receipt initial');
  expect(()=>db.exec('UPDATE output_cleanup_receipts SET receipt_json=receipt_json')).toThrow('immutable cleanup receipt');expect(()=>db.exec('DELETE FROM output_cleanup_receipts')).toThrow('retained cleanup receipt');
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
