import {checkedOrganizationOverview,checkedOrganizationOverviewQuery} from '../../../application/organization-overview/index.js';
import {requireRule} from '../../../domain/namespaces/index.js';
import type {DatabaseSync} from 'node:sqlite';
import type {WorkspaceOverview,OrganizationOverview,OverviewRun} from '@beetle/contracts/api';
import type {OverviewQuery,OrganizationOverviewQuery} from '../../../ports/overview.js';
import {checkedOverview,checkedOverviewQuery} from '../../../application/overview/index.js';
import type {Suites} from './suites.js';
import {normalizedScope} from './suites.js';
import {transaction} from './transaction.js';
const hour=3600000;
const summary='id,suite_id AS suiteId,revision_id AS revisionId,requested_at AS requestedAt,state,outcome';
export class Overviews{
 constructor(private readonly db:DatabaseSync,private readonly suites:Suites){}
 read(input:OverviewQuery):WorkspaceOverview{
  const query=checkedOverviewQuery(input);
  return transaction(this.db,()=>checkedOverview(this.snapshot(query),query));
 }
 readOrganization(input:OrganizationOverviewQuery):OrganizationOverview{
  const query=checkedOrganizationOverviewQuery(input);return transaction(this.db,()=>checkedOrganizationOverview(this.snapshot(query),query));
 }
 private snapshot(query:OverviewQuery|OrganizationOverviewQuery){
  const scope=this.scope(query);const args=scope.kind==='workspace'?[scope.organizationId,scope.workspaceId]:[scope.organizationId];
  const scopeWhere=scope.kind==='workspace'?'organization_id=? AND workspace_id=?':'organization_id=?';
  const now=Date.parse(query.now);const start=now-24*hour;const windowStart=new Date(start).toISOString();
  const counts=this.counts(args,scopeWhere,windowStart,query.now);
  const grouped=this.db.prepare(`SELECT CAST((unixepoch(requested_at,'subsec')*1000-?)/? AS INTEGER) AS bucket,COUNT(*) AS count FROM runs
   WHERE ${scopeWhere} AND requested_at>=? AND requested_at<? GROUP BY bucket`).all(start,hour,...args,windowStart,query.now) as unknown as {bucket:number;count:number}[];
  const activity=Array.from({length:24},(_,index)=>({from:new Date(start+index*hour).toISOString(),to:new Date(start+(index+1)*hour).toISOString(),count:grouped.find(row=>row.bucket===index)?.count??0}));
  const recent=this.db.prepare(`SELECT ${summary}${scope.kind==='organization'?',workspace_id AS workspaceId':''} FROM runs WHERE ${scopeWhere} ORDER BY requested_at DESC,id DESC LIMIT 8`).all(...args) as unknown as OverviewRun[];
  const active=this.db.prepare(`SELECT ${summary}${scope.kind==='organization'?',workspace_id AS workspaceId':''} FROM runs WHERE ${scopeWhere} AND state='active' ORDER BY requested_at DESC,id DESC LIMIT 20`).all(...args) as unknown as OverviewRun[];
  return {scope,generatedAt:query.now,windowStart,counts,activity,recent,active,activeHasMore:counts.active>20,
   ...(scope.kind==='organization'?{workspaces:this.db.prepare('SELECT COUNT(*) n FROM workspaces WHERE organization_id=?').get(scope.organizationId)!.n}:{})};
 }
 private scope(query:OverviewQuery|OrganizationOverviewQuery){
  if(query.scope.kind==='workspace'){this.suites.workspace(query.scope);return normalizedScope(query.scope);}
  const organizationId=query.scope.organizationId.toLowerCase();
  requireRule(!!this.db.prepare('SELECT 1 FROM organizations WHERE id=?').get(organizationId),'not_found');
  return {kind:'organization' as const,organizationId};
 }
 private counts(args:string[],scopeWhere:string,from:string,to:string):WorkspaceOverview['counts']{
  const states=['queued','dispatching','active','finalizing','finished','cancelled','errored'] as const;
  const stateSql=states.map(state=>`COALESCE(SUM(state='${state}'),0) AS ${state}`).join(',');
  const runCounts=this.db.prepare(`SELECT COUNT(*) AS runs,${stateSql},
   COUNT(*) FILTER(WHERE requested_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',requested_at)) AS invalidTimes,
   COALESCE(SUM(requested_at>=? AND requested_at<?),0) AS submitted24h,
   COALESCE(SUM(requested_at>=? AND requested_at<? AND outcome='failed'),0) AS failed24h FROM runs WHERE ${scopeWhere}`)
   .get(from,to,from,to,...args) as unknown as Omit<WorkspaceOverview['counts'],'folders'|'suites'>&{invalidTimes:number};
  const {invalidTimes,...validCounts}=runCounts;requireRule(invalidTimes===0);
  const folders=this.db.prepare(`SELECT COUNT(*) AS count FROM folders WHERE ${scopeWhere}`).get(...args)!.count as number;
  const suites=this.db.prepare(`SELECT COUNT(*) AS count FROM suites WHERE ${scopeWhere}`).get(...args)!.count as number;
  return {...validCounts,folders,suites};
 }
}
