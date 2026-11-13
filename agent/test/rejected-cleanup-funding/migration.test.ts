import { expect,it } from 'vitest';
import { initialize,JOURNAL_SCHEMA_VERSION } from '../../src/journal/schema.js';
import { migration022 } from '../../src/journal/migration022.js';
import { asSchema21 } from '../storage-settlement/legacy021.js';
import { retirementFixture } from '../retirement/fixtures.js';
const f=retirementFixture();
it('upgrades the actual schema22 objects preserving admitted debt and creating no rejected backfill',async()=>{
 const v=await f.ready();await f.close(v.journal);let db=initialize(v.path);
 try{
  asSchema21(db);db.exec(migration022);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(22);
  const original=db.prepare('SELECT * FROM accepted_attempts').all();const holds=db.prepare('SELECT * FROM disk_holds').all();
  const replay=db.prepare('SELECT * FROM agent_replay_storage').all();
  const intentTrigger=db.prepare("SELECT sql FROM sqlite_schema WHERE name='retirement_initial'").get()?.sql;
  db.close();db=initialize(v.path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(JOURNAL_SCHEMA_VERSION);
  expect(db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(original);
  expect(db.prepare('SELECT * FROM disk_holds').all()).toEqual(holds);
  expect(db.prepare('SELECT * FROM agent_replay_storage').all()).toEqual(replay);
  expect(db.prepare('SELECT count(*) n FROM rejected_cleanup_controls').get()?.n).toBe(0);
  expect(db.prepare('SELECT * FROM rejected_cleanup_storage').get()).toMatchObject({id:1,original_count:0,charged_bytes:0,last_clock:0});
  expect(intentTrigger).not.toContain('rejected_intent_insert_allowed');
  expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='retirement_initial'").get()?.sql).toContain('rejected_intent_insert_allowed');
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
