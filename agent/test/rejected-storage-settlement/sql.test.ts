import { expect,it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixtures.js';
import { initialize } from '../../src/journal/schema.js';
import { commitAgentSettlement } from '../../src/journal/settlement-guard/index.js';
import { purgeOrder } from '../../src/journal/settlements/purge-order.js';
import { transaction } from '../../src/journal/sql.js';
const f=fixture();
function snapshot(db:DatabaseSync){return [...purgeOrder,'agent_replay_storage','retired_attempts','rejected_cleanup_storage','disk_retention_stats','installed_staging_namespace','admission_settings']
 .map(table=>({table,rows:db.prepare(`SELECT * FROM ${table}`).all()}));}
it.each(['clock','hold','global','parent','replay','nested'] as const)('rolls back the entire original and credits after a late %s attack',async kind=>{
 const e=await f.cleaned();await f.close(e.owner);const db=initialize(e.journalPath);
 try{
  if(kind==='nested')db.function('synthetic_nested',()=>{commitAgentSettlement(db,e.request);return 1;});
  const effect={clock:'UPDATE rejected_cleanup_storage SET last_clock=last_clock+1;',hold:'UPDATE disk_retention_stats SET held_count=held_count;',
   global:'UPDATE admission_settings SET observation_json=NULL;',parent:'DELETE FROM accepted_attempts;',
   replay:'UPDATE agent_replay_storage SET original_count=original_count+1,charged_bytes=charged_bytes+4096;',nested:'SELECT synthetic_nested();'}[kind];
  db.exec(`CREATE TRIGGER synthetic_attack AFTER DELETE ON rejected_cleanup_controls BEGIN ${effect} END;`);const before=snapshot(db);
  const clock=db.prepare('SELECT last_clock FROM rejected_cleanup_storage').get();
  expect(()=>transaction(db,()=>commitAgentSettlement(db,e.request))).toThrow();expect(snapshot(db)).toEqual(before);
  db.exec('DROP TRIGGER synthetic_attack');const reply=transaction(db,()=>commitAgentSettlement(db,e.request));expect(reply.chargedBytes).toBe(4096);
  expect(db.prepare('SELECT last_clock FROM rejected_cleanup_storage').get()).toEqual(clock);
 }finally{db.close();e.fence.release();}
});
