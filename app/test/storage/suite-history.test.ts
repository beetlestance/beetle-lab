import {expect,it} from 'vitest';
import {scope,seed,storageFixture,uuid} from './fixture.js';
import {append,createSuite} from './suites-fixture.js';
import {runCommand,runOptions} from './runs-fixture.js';
import {claimsFixture} from './dispatch-claim-fixtures.js';
import {runListStatement} from '../../src/adapters/outbound/sqlite/run-list-query.js';
const fixture=storageFixture();
it('reads exact-suite history across revisions, filters, keysets and compiled-worker reopen',async()=>{
 const path=fixture.path();let metadata=await fixture.open(path,runOptions());await seed(metadata);await seed(metadata,11,12,13);
 const suite=await createSuite(metadata);const first=await append(metadata,suite);const peer=await append(metadata,await createSuite(metadata,51,scope,'Peer'),61);const second=await append(metadata,await metadata.suites.getSuite({scope,id:suite.id}),62);
 for(const [revision,id] of [[first.id,500],[peer.id,501],[first.id,502],[second.id,503]] as const)await metadata.runs.execute(runCommand(revision,id));
 const query={scope,limit:1,suiteId:suite.id};const page=await metadata.runs.listRuns(query);expect(page.items.map(row=>row.id)).toEqual([uuid(503)]);
 const next=await metadata.runs.listRuns({...query,cursor:page.nextCursor!});expect(next.items.map(row=>row.id)).toEqual([uuid(502)]);
 await expect(metadata.runs.listRuns({...query,suiteId:peer.suiteId,cursor:page.nextCursor!})).rejects.toMatchObject({code:'invalid_input'});
 expect((await metadata.runs.listRuns({...query,name:'Peer'})).items).toEqual([]);
 expect((await metadata.runs.listRuns({...query,name:suite.name})).items.map(row=>row.id)).toEqual([uuid(503)]);
 expect((await metadata.runs.listRuns({...query,runIdPrefix:uuid(500).slice(0,8),order:'oldest'})).items.map(row=>row.id)).toEqual([uuid(500)]);
 await expect(metadata.runs.listRuns({...query,scope:{...scope,organizationId:uuid(11),workspaceId:uuid(12)}})).rejects.toMatchObject({code:'not_found'});
 await fixture.close(metadata);metadata=await fixture.open(path,runOptions());expect(await metadata.runs.listRuns(query)).toEqual(page);
});
it('rejects foreign suite and bad cursor before pending name-index work and uses scoped ordering indexes',()=>{
 const f=claimsFixture();try{
  f.db.prepare('INSERT OR REPLACE INTO history_name_progress VALUES(?,?,\'\',\'\',0,0)').run(scope.organizationId,scope.workspaceId);
  const before=f.db.prepare('SELECT * FROM history_name_progress').all();const grams=f.db.prepare('SELECT * FROM history_name_grams ORDER BY term').all();
  expect(()=>f.reads.list({scope,limit:1,suiteId:uuid(99),name:'Pending'})).toThrow('not found');
  expect(()=>f.reads.list({scope,limit:1,suiteId:uuid(50),name:'Pending',cursor:'bad'})).toThrow();
  expect(f.db.prepare('SELECT * FROM history_name_progress').all()).toEqual(before);expect(f.db.prepare('SELECT * FROM history_name_grams ORDER BY term').all()).toEqual(grams);
  for(const state of [undefined,'queued' as const]){
   const statement=runListStatement({scope,limit:1,suiteId:uuid(50),...(state?{state}:{})});
   const plan=f.db.prepare('EXPLAIN QUERY PLAN '+statement.sql).all(...statement.values);
   expect(plan.some(row=>String(row.detail).includes(state?'runs_history_suite_state':'runs_history_suite'))).toBe(true);
   expect(plan.some(row=>String(row.detail).includes('TEMP B-TREE'))).toBe(false);
  }
 }finally{f.db.close();}
});
