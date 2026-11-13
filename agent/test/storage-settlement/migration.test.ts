import { expect,it } from 'vitest';
import { initializePrior021 } from './prior021.js';
import { migration022 } from '../../src/journal/migration022.js';
import { registerSettlementGuard } from '../../src/journal/settlement-guard/index.js';
import { transaction } from '../../src/journal/sql.js';
import { journalFixture } from '../journal/fixtures.js';
import { offerInput } from '../../src/journal/input.js';
import type { DatabaseSync } from 'node:sqlite';
const f=journalFixture();
function previous(path=':memory:'){
 const db=initializePrior021(path);const offer=f.offer();const input=offerInput(offer);
 db.prepare(`INSERT INTO accepted_attempts(attempt_id,organization_id,workspace_id,intent_digest,generation,state,last_seq,offer_json,canonical_json,quota_bytes)
  VALUES(?,?,?,?,1,'offered',0,?,?,67108864)`).run(offer.attemptId,offer.organizationId,offer.workspaceId,offer.intentDigest,input.json,input.canonical);
 db.prepare('UPDATE admission_settings SET last_clock=999 WHERE id=1').run();return{db,offer};
}
function rows(db:DatabaseSync){
 return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row=>({name:row.name,
  rows:db.prepare('SELECT * FROM "'+String(row.name).replaceAll('"','""')+'"').all()}));
}
function graph(db:DatabaseSync){return db.prepare("SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name").all();}
it('migrates actual schema021 without mutating old rows or inventing replay charges and reopens in the real worker',async()=>{
 const path=f.path();const{db,offer}=previous(path);const before=rows(db);const oldGraph=graph(db);registerSettlementGuard(db);
 try{
  transaction(db,()=>db.exec(migration022));const after=rows(db);
  for(const row of before)expect(after.find(value=>value.name===row.name)).toEqual(row);
  for(const item of oldGraph){
   const next=graph(db).find(value=>value.name===item.name&&value.type===item.type);
   if(item.type==='trigger'&&String(next?.sql).includes('agent_settlement_delete_allowed')){
    expect(String(item.sql)).toMatch(/BEFORE DELETE/);expect(String(next?.sql)).toContain(`ON ${String(item.tbl_name)}`);
   }else expect(next).toEqual(item);
  }
  expect(db.prepare('SELECT * FROM agent_replay_storage').get()).toEqual({id:1,original_count:0,charged_bytes:0});
  expect(db.prepare('SELECT count(*) n FROM retired_attempts').get()?.n).toBe(0);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
 const owner=await f.open(path);expect(await owner.immutableOffer(offer)).toMatchObject({attemptId:offer.attemptId,state:'offered'});
});
it('rolls a late migration DDL collision back including its guard replacements and preserves predecessor version',()=>{
 const{db}=previous();registerSettlementGuard(db);
 try{
  db.exec('CREATE TRIGGER settlement_global_admission_settings_update BEFORE UPDATE ON admission_settings WHEN 0 BEGIN SELECT 1;END');
  const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration022))).toThrow();expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(21);
 }finally{db.close();}
});
