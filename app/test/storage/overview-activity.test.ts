import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { overviewFilter } from '../../src/adapters/outbound/sqlite/overview-filter.js';
import { overviewActivitySql, readOverviewActivity } from '../../src/adapters/outbound/sqlite/overview-activity.js';
import { scope } from './fixture.js';
const databases: DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture() {
 const db=new DatabaseSync(':memory:');databases.push(db);
 db.exec('CREATE TABLE runs(organization_id TEXT,workspace_id TEXT,requested_at TEXT,state TEXT,outcome TEXT)');
 const insert=db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)');
 return {db,add:(at:string,state:string,outcome:string,workspace=scope.workspaceId)=>insert.run(scope.organizationId,workspace,at,state,outcome)};
}
it('buckets exact integer milliseconds at both edges of an unrounded 24-hour window',()=>{
 const {db,add}=fixture();const now='2026-11-12T12:00:00.137Z';
 add('2026-11-11T12:00:00.137Z','finished','passed');
 add('2026-11-11T13:00:00.136Z','finished','failed');
 add('2026-11-11T13:00:00.137Z','active','pending');
 add('2026-11-12T12:00:00.136Z','cancelled','inconclusive');
 add(now,'finished','passed');add('2026-11-12T12:00:00.138Z','finished','passed');
 add('2026-11-12T11:00:00.000Z','active','pending','ffffffff-ffff-4fff-8fff-ffffffffffff');
 const result=readOverviewActivity(db,overviewFilter(scope,false),now);
 expect(result).toHaveLength(24);
 expect(result[0]).toMatchObject({count:2,outcomes:{passed:1,failed:1,inProgress:0,other:0}});
 expect(result[1]).toMatchObject({count:1,outcomes:{passed:0,failed:0,inProgress:1,other:0}});
 expect(result[23]).toMatchObject({count:1,outcomes:{passed:0,failed:0,inProgress:0,other:1}});
 expect(result.reduce((sum,bucket)=>sum+bucket.count,0)).toBe(4);
});
it('refuses unaccountable stored state without poisoning another scope read',()=>{
 const {db,add}=fixture();add('2026-11-12T11:00:00.000Z','finished','pending');
 expect(()=>readOverviewActivity(db,overviewFilter(scope,false),'2026-11-12T12:00:00.000Z')).toThrow();
 const other={...scope,workspaceId:'ffffffff-ffff-4fff-8fff-ffffffffffff'};
 expect(readOverviewActivity(db,overviewFilter(other,false),'2026-11-12T12:00:00.000Z').every(bucket=>bucket.count===0)).toBe(true);
});
it('keeps retired workspaces out of live organisation outcomes and in restored history',()=>{
 const {db,add}=fixture();
 db.exec('CREATE TABLE workspaces(id TEXT,organization_id TEXT,retired INTEGER); CREATE INDEX workspaces_visible ON workspaces(organization_id,retired,id)');
 const retired='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',foreign='ffffffff-ffff-4fff-8fff-ffffffffffff';
 const workspace=db.prepare('INSERT INTO workspaces VALUES(?,?,?)');
 workspace.run(scope.workspaceId,scope.organizationId,0);workspace.run(retired,scope.organizationId,1);workspace.run(foreign,foreign,0);
 add('2026-11-12T11:00:00.000Z','finished','passed');add('2026-11-12T11:00:00.000Z','finished','failed',retired);
 db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(foreign,foreign,'2026-11-12T11:00:00.000Z','finished','failed');
 const owner={kind:'organization' as const,organizationId:scope.organizationId},now='2026-11-12T12:00:00.000Z';
 const live=readOverviewActivity(db,overviewFilter(owner,false),now);
 const restored=readOverviewActivity(db,overviewFilter(owner,true),now);
 expect(live[23]).toMatchObject({count:1,outcomes:{passed:1,failed:0,inProgress:0,other:0}});
 expect(restored[23]).toMatchObject({count:2,outcomes:{passed:1,failed:1,inProgress:0,other:0}});
 const plan=db.prepare('EXPLAIN QUERY PLAN '+overviewActivitySql(overviewFilter(owner,false))).all(Date.parse(now)-86400000,3600000,scope.organizationId,scope.organizationId,'2026-11-11T12:00:00.000Z',now);
 expect(plan.some(row=>String(row.detail).includes('workspaces_visible'))).toBe(true);
});
