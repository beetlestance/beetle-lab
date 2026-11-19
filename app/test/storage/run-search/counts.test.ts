import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { encodeRunListCursor } from '@beetle/contracts/api';
import type { RunListQuery } from '@beetle/contracts/api';
import { historyCounts, historyCountsStatement } from '../../../src/adapters/outbound/sqlite/run-search/counts.js';
import type { HistorySelection } from '../../../src/adapters/outbound/sqlite/run-search/selection.js';
import type { PrefixKey } from '../../../src/adapters/outbound/sqlite/run-search/rows.js';
import { scope, uuid } from '../fixture.js';
const databases:DatabaseSync[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function fixture(){
 const db=new DatabaseSync(':memory:');databases.push(db);
 db.exec(`CREATE TABLE runs(id TEXT,organization_id TEXT,workspace_id TEXT,suite_id TEXT,state TEXT,outcome TEXT,requested_at TEXT);
 CREATE INDEX runs_history_state_outcome ON runs(organization_id,workspace_id,state,outcome,requested_at,id);
 CREATE INDEX runs_history_suite_state_outcome ON runs(organization_id,workspace_id,suite_id,state,outcome,requested_at,id);`);
 const rows:PrefixKey[]=Array.from({length:6},(_,i)=>({id:uuid(500+i),suite_id:uuid(i<4?50:51),requested_at:'2026-11-09T00:00:00.000Z',state:i===0?'active':i===3?'cancelled':'finished',outcome:i===0?'pending':i===3?'inconclusive':i===2?'failed':'passed'}));
 const insert=db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)');for(const row of rows)insert.run(row.id,scope.organizationId,scope.workspaceId,row.suite_id,row.state,row.outcome,row.requested_at);
 // Identical IDs in another scope never enter this snapshot.
 for(const row of rows)insert.run(row.id,uuid(11),uuid(12),row.suite_id,row.state,row.outcome,row.requested_at);
 const selection:HistorySelection={suites:null,notes:[],prefix:undefined,pinned:[rows[1]!,rows[3]!]};
 return {db,rows,selection,read:(query:RunListQuery={limit:2})=>historyCounts(db,{scope,...query},selection)};
}
it('counts complete context independently of chips and computes the exact current keyset range',()=>{
 const f=fixture();expect(f.read()).toEqual({all:6,running:1,passed:3,failed:1,cancelled:1,pinned:2,matched:6,before:0});
 expect(f.read({limit:2,outcome:'passed'})).toMatchObject({all:6,passed:3,matched:3});
 expect(f.read({limit:2,pinned:true})).toMatchObject({all:6,pinned:2,matched:2});
 const cursor=encodeRunListCursor({scope,query:{limit:2,order:'newest'},requestedAt:f.rows[4]!.requested_at,id:f.rows[4]!.id});
 expect(f.read({limit:2,cursor})).toMatchObject({matched:6,before:2});
 const oldest=encodeRunListCursor({scope,query:{limit:2,order:'oldest'},requestedAt:f.rows[1]!.requested_at,id:f.rows[1]!.id});
 expect(f.read({limit:2,order:'oldest',cursor:oldest})).toMatchObject({matched:6,before:2});
});
it('deduplicates suite and note matches while retaining note-only runs and suite narrowing',()=>{
 const f=fixture();f.selection.suites=[uuid(50)];f.selection.notes=[f.rows[1]!,f.rows[4]!];
 expect(f.read()).toMatchObject({all:5,passed:2,pinned:2});
 expect(f.read({limit:2,suiteId:uuid(51)})).toMatchObject({all:1,passed:1,pinned:0});
 f.selection.prefix=[f.rows[1]!];expect(f.read({limit:2,runIdPrefix:f.rows[1]!.id})).toMatchObject({all:1,passed:1,failed:0,pinned:1});
});
it('uses actual covering aggregate statements and refuses corrupt grouped metadata',()=>{
 const f=fixture();for(const suiteId of [undefined,uuid(50)]){
  const statement=historyCountsStatement({scope,limit:2},suiteId);
  const plan=f.db.prepare('EXPLAIN QUERY PLAN '+statement.sql).all(...statement.values).map(row=>row.detail).join(' ');
  expect(plan).toContain('COVERING INDEX '+(suiteId?'runs_history_suite_state_outcome':'runs_history_state_outcome'));
  expect(plan).not.toContain('TEMP B-TREE');
 }
 f.db.prepare('UPDATE runs SET state=? WHERE id=?').run('unknown-state',f.rows[0]!.id);expect(()=>f.read()).toThrow();
 f.db.prepare('UPDATE runs SET state=?,requested_at=? WHERE id=?').run('active','not-time',f.rows[0]!.id);expect(()=>f.read()).toThrow();
});

it('keeps aggregate results bounded across a larger indexed workspace',()=>{
 const f=fixture();const insert=f.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)');
 f.db.exec('BEGIN');for(let i=0;i<50000;i++)insert.run(uuid(1000+i),scope.organizationId,scope.workspaceId,uuid(50),'finished','passed','2026-11-09T00:00:00.000Z');f.db.exec('COMMIT');
 const started=performance.now();const value=f.read();const ms=performance.now()-started;
 expect(value).toMatchObject({all:50006,passed:50003,before:0,matched:50006});
 console.info(JSON.stringify({measurement:'history-counts',rows:50006,elapsedMs:Math.round(ms*100)/100}));
});
