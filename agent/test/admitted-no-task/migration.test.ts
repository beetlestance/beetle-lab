import { expect,it } from 'vitest';
import { fixture } from '../no-task-receipt/fixtures.js';
import { initialize,JOURNAL_SCHEMA_VERSION } from '../../src/journal/schema.js';
import { prior025 } from './prior025.js';
const f=fixture();
it('preserves an actual pending rejected receipt, funding debt, original bytes and FK/trigger protection from025',async()=>{
 const e=await f.ready();const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},e.ports);
 expect(await work.result).toMatchObject({ok:true});await work.quiesced;await f.close(e.owner);
 const historical=prior025();let db=initialize(e.journalPath);
 try{
  const oldTriggers=historical.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='rejected_cleanup_receipts' ORDER BY name").all();
  const current=db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name='output_no_task_cleanup_receipts' ORDER BY name LIMIT 17").all();
  expect(current.length).toBeLessThanOrEqual(16);
  for(const row of current)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
  db.exec('ALTER TABLE output_no_task_cleanup_receipts RENAME TO rejected_cleanup_receipts');
  for(const row of oldTriggers)db.exec(String(row.sql));db.exec('PRAGMA user_version=25');
  const receipt=db.prepare('SELECT * FROM rejected_cleanup_receipts').all();const originals=db.prepare('SELECT * FROM accepted_attempts').all();
  const controls=db.prepare('SELECT * FROM rejected_cleanup_controls').all();const counters=db.prepare('SELECT * FROM rejected_cleanup_storage').all();
  const page=db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='rejected_cleanup_receipts'").get()?.rootpage;
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);db.close();db=initialize(e.journalPath);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(JOURNAL_SCHEMA_VERSION);
  expect(db.prepare('SELECT * FROM output_no_task_cleanup_receipts').all()).toEqual(receipt);
  expect(db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(originals);expect(db.prepare('SELECT * FROM rejected_cleanup_controls').all()).toEqual(controls);
  expect(db.prepare('SELECT * FROM rejected_cleanup_storage').all()).toEqual(counters);
  expect(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='output_no_task_cleanup_receipts'").get()?.rootpage).toBe(page);
  expect(db.prepare('PRAGMA foreign_key_list(output_no_task_cleanup_receipts)').all().some(row=>row.table==='accepted_attempts')).toBe(true);
  const triggers=db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='output_no_task_cleanup_receipts'").all();
  expect(triggers).toHaveLength(current.length);
  expect(triggers.every(row=>String(row.sql).includes('ON "output_no_task_cleanup_receipts"')||String(row.sql).includes('ON output_no_task_cleanup_receipts'))).toBe(true);
  expect(triggers.some(row=>String(row.sql).includes("agent_settlement_delete_allowed(OLD.attempt_id,'rejected_cleanup_receipts')"))).toBe(false);
  expect(()=>db.exec('DELETE FROM output_no_task_cleanup_receipts')).toThrow();expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();historical.close();}
});
