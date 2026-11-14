import type {Suite,Run,RunPage} from '@beetle/contracts/api';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {useApi,readResult} from '../../app/api.js';
import {queryKeys} from '../../app/queries.js';
import {routes} from '../../app/routes.js';
export {ConfigurationSummary} from './ConfigurationSummary.js';
export function SuiteLatestRun({suite}:{suite:Suite}){
 const api=useApi();const params={organizationId:suite.scope.organizationId,workspaceId:suite.scope.workspaceId};
 const page={limit:1,order:'newest' as const,suiteId:suite.id};
 const query=useQuery({queryKey:queryKeys.runsPage(params.organizationId,params.workspaceId,'',page),
  queryFn:({signal})=>readResult(api.listRuns({params,query:page,signal}))});
 return <section aria-label="Suite run history"><header><h2>Suite run history</h2>
  <button disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh latest run</button></header>
  <LatestRunBody pending={query.isPending} error={query.isError} page={query.data} suite={suite}/>
  <Link to={`${routes.runs(params.organizationId,params.workspaceId)}?suiteId=${encodeURIComponent(suite.id)}`}>All history for this suite</Link>
 </section>;
}
function LatestRunBody({pending,error,page,suite}:{pending:boolean;error:boolean;page:RunPage|undefined;suite:Suite}){
 if(pending)return <p role="status">Reading latest retained run…</p>;
 if(error)return <p role="alert">Latest run is unknown. Refresh to retry.</p>;
 if(!page)return null;const run=page.items[0];
 if(!run)return <p>No retained runs for this suite. Earlier runs may have been removed.</p>;
 return <LatestRunLine run={run} suite={suite}/>;
}
function LatestRunLine({run,suite}:{run:Run;suite:Suite}){
 return <p>Latest retained submission: <Link to={routes.run(suite.scope.organizationId,suite.scope.workspaceId,run.id)}>{run.id}</Link>
  {' '}<time dateTime={run.requestedAt}>{run.requestedAt}</time> — {run.state} / {run.outcome}
  {run.revisionId.toLowerCase()!==suite.currentRevisionId?.toLowerCase()&&' (different saved revision)'}</p>;
}
