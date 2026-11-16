import { runHistorySummaryMatches } from './run-history-summary.js';
import type {Run,RunListQuery,RunPage,WorkspaceScope} from './generated/types.js';
import {compareRunListPosition,encodeRunListCursor,normalizeRunListQuery,runListPosition,runListTimestamp} from './run-list.js';
import type {NormalizedRunListQuery,RunListPosition} from './run-list.js';
function owns(row:Run,scope:WorkspaceScope):boolean{
 return row.scope.organizationId.toLowerCase()===scope.organizationId.toLowerCase()&&row.scope.workspaceId.toLowerCase()===scope.workspaceId.toLowerCase();
}
function accepts(row:Run,query:NormalizedRunListQuery):boolean{
 return (query.state===undefined||row.state===query.state)&&(query.outcome===undefined||row.outcome===query.outcome)&&runListTimestamp(row.requestedAt)
  &&(query.suiteId===undefined||row.suiteId.toLowerCase()===query.suiteId)
  &&(query.runIdPrefix===undefined||row.id.toLowerCase().startsWith(query.runIdPrefix));
}
function ordered(rows:readonly Run[],position:RunListPosition|null,scope:WorkspaceScope,query:NormalizedRunListQuery):boolean{
 const ids=new Set<string>();let prior:Pick<Run,'id'|'requestedAt'>|null=position;
 return rows.every(row=>{
  const id=row.id.toLowerCase();if(ids.has(id)||!owns(row,scope)||!accepts(row,query))return false;
  ids.add(id);const comparison=prior===null?null:compareRunListPosition(row,prior);prior=row;
  return comparison===null||(query.order==='newest'?comparison<0:comparison>0);
 });
}
/** After schema/byte capture: scope, filters, keyset order and exact continuation. */
export function runListPageMatches(page:RunPage,owner:WorkspaceScope,input:RunListQuery):boolean{
 try{
  const query=normalizeRunListQuery(input);const position=runListPosition(owner,query);
  if(page.scope.organizationId.toLowerCase()!==owner.organizationId.toLowerCase()||page.scope.workspaceId.toLowerCase()!==owner.workspaceId.toLowerCase())return false;
  if(page.items.length>query.limit||!ordered(page.items,position,owner,query))return false;
  if(!historyMatches(page))return false;
  if(page.nextCursor===null)return true;
  const last=page.items.at(-1);if(!last||page.items.length!==query.limit)return false;
  return page.nextCursor===encodeRunListCursor({scope:owner,query,requestedAt:last.requestedAt,id:last.id});
 }catch{return false;}
}

function historyMatches(page: RunPage): boolean {
 return page.summaries.length === page.items.length
  && page.summaries.every((summary, index) => runHistorySummaryMatches(summary, page.items[index]!));
}
