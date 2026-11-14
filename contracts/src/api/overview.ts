import type {WorkspaceOverview,OverviewRun,WorkspaceScope,OrganizationOverview,OrganizationScope} from './generated/types.js';
type OverviewFacts = Omit<WorkspaceOverview,'scope'>;
const hour=3600000;
const states=['queued','dispatching','active','finalizing','finished','cancelled','errored'] as const;
function canonical(value:string):number|null{
 const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString()===value?time:null;
}
function runValid(row:OverviewRun):boolean{
 if(canonical(row.requestedAt)===null)return false;
 if(row.state==='finished')return ['passed','failed','inconclusive'].includes(row.outcome);
 if(row.state==='cancelled'||row.state==='errored')return row.outcome==='inconclusive';
 return row.outcome==='pending';
}
function ordered(rows:readonly OverviewRun[]):boolean{
 const seen=new Set<string>();
 return rows.every((row,index)=>{
  const id=row.id.toLowerCase();if(seen.has(id)||!runValid(row))return false;seen.add(id);
  const previous=rows[index-1];if(!previous)return true;
  return previous.requestedAt>row.requestedAt||(previous.requestedAt===row.requestedAt&&previous.id.toLowerCase()>id);
 });
}
/** After schema validation: exact scope, bounded lists and snapshot arithmetic. */
export function workspaceOverviewMatches(value:WorkspaceOverview,scope:Pick<WorkspaceScope,'organizationId'|'workspaceId'>):boolean{
 if(value.scope.organizationId.toLowerCase()!==scope.organizationId.toLowerCase()||value.scope.workspaceId.toLowerCase()!==scope.workspaceId.toLowerCase())return false;
 return overviewFactsMatch(value);
}
function overviewFactsMatch(value:OverviewFacts):boolean{
 const now=canonical(value.generatedAt);const start=canonical(value.windowStart);
 if(now===null||start===null||start<0||now-start!==24*hour)return false;
 return validCounts(value)&&validActivity(value,start)&&validLists(value);
}
function validCounts({counts:c}:OverviewFacts):boolean{
 const total=states.reduce((sum,state)=>sum+c[state],0);
 return Number.isSafeInteger(total)&&total===c.runs&&c.submitted24h<=c.runs&&c.failed24h<=c.submitted24h&&c.failed24h<=c.finished;
}
function validActivity(value:OverviewFacts,start:number):boolean{
 let total=0;
 const valid=value.activity.every((bucket,index)=>{
  total+=bucket.count;
  return canonical(bucket.from)===start+index*hour&&canonical(bucket.to)===start+(index+1)*hour;
 });
 return valid&&Number.isSafeInteger(total)&&total===value.counts.submitted24h;
}
function validLists(value:OverviewFacts):boolean{
 return value.recent.length===Math.min(8,value.counts.runs)&&value.active.length===Math.min(20,value.counts.active)
  &&value.activeHasMore===(value.counts.active>20)&&value.active.every(row=>row.state==='active')
  &&ordered(value.recent)&&ordered(value.active)&&consistentLists(value)&&consistentWindow(value);
}

function sameSummary(left:OverviewRun,right:OverviewRun):boolean{
 return left.id.toLowerCase()===right.id.toLowerCase()&&left.suiteId.toLowerCase()===right.suiteId.toLowerCase()
  &&left.revisionId.toLowerCase()===right.revisionId.toLowerCase()&&left.requestedAt===right.requestedAt
  &&left.state===right.state&&left.outcome===right.outcome;
}
function consistentLists(value:OverviewFacts):boolean{
 const tallies=new Map<OverviewRun['state'],number>();
 return value.recent.every(row=>{
  const count=(tallies.get(row.state)??0)+1;tallies.set(row.state,count);
  if(count>value.counts[row.state])return false;
  const active=value.active.find(candidate=>candidate.id.toLowerCase()===row.id.toLowerCase());
  if(row.state==='active')return active!==undefined&&sameSummary(row,active);
  return active===undefined;
 });
}

function consistentWindow(value:OverviewFacts):boolean{
 const submitted=value.recent.filter(row=>row.requestedAt>=value.windowStart&&row.requestedAt<value.generatedAt);
 const failed=submitted.filter(row=>row.outcome==='failed').length;
 if(submitted.length>value.counts.submitted24h||failed>value.counts.failed24h)return false;
 return value.counts.runs>8||(submitted.length===value.counts.submitted24h&&failed===value.counts.failed24h);
}

export function organizationOverviewMatches(value:OrganizationOverview,scope:Pick<OrganizationScope,'organizationId'>):boolean{
 if(value.scope.organizationId.toLowerCase()!==scope.organizationId.toLowerCase()||!overviewFactsMatch(value))return false;
 if(value.counts.folders<value.workspaces||(value.workspaces===0&&Object.values(value.counts).some(count=>count!==0)))return false;
 const workspaces=new Set([...value.recent,...value.active].map(row=>row.workspaceId.toLowerCase()));
 if(workspaces.size>value.workspaces)return false;
 return value.recent.every(row=>{
  const active=value.active.find(peer=>peer.id.toLowerCase()===row.id.toLowerCase());
  return !active||active.workspaceId.toLowerCase()===row.workspaceId.toLowerCase();
 });
}
