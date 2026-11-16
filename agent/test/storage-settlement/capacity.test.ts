import { expect,it } from 'vitest';
import { fixture,offline } from './fixtures.js';
import { transaction } from '../../src/journal/sql.js';
import { commitAgentSettlement } from '../../src/journal/settlement-guard/index.js';
const f=fixture();
it('transfers pre-funded replay metadata even when current limits are below the retained original charge',async()=>{
 const e=await f.cleaned();const db=await offline(e);
 try{
  const old=db.prepare('SELECT held_staging_bytes FROM disk_retention_stats').get()?.held_staging_bytes;
  expect(Number(old)).toBeGreaterThan(65536);
  const row=db.prepare('SELECT configuration_json FROM admission_settings').get();
  const config=JSON.parse(String(row?.configuration_json)) as {pool:{stagingBytes:number};perRun:{stagingBytes:number}};
  config.pool.stagingBytes=4096;config.perRun.stagingBytes=4096;
  db.prepare('UPDATE admission_settings SET configuration_json=? WHERE id=1').run(JSON.stringify(config));
  const reply=transaction(db,()=>commitAgentSettlement(db,e.request));expect(reply).toMatchObject({state:'settled',chargedBytes:4096});
  expect(db.prepare('SELECT charged_bytes FROM agent_replay_storage').get()?.charged_bytes).toBe(4096);
  expect(db.prepare('SELECT held_count,retained_staging_bytes FROM disk_retention_stats').get()).toEqual({held_count:0,retained_staging_bytes:0});
 }finally{db.close();e.fence.release();}
});
