import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import type {OverviewRun,WorkspaceOverview as Snapshot} from '@beetle/contracts/api';
import {readResult,useApi} from '../../app/api.js';
import {queryKeys} from '../../app/queries.js';
import {routes} from '../../app/routes.js';
export function WorkspaceOverview({organizationId,workspaceId}:{organizationId:string;workspaceId:string}){
 const api=useApi();const query=useQuery({queryKey:[...queryKeys.workspace(organizationId,workspaceId),'overview'],
  queryFn:({signal})=>readResult(api.getWorkspaceOverview({params:{organizationId,workspaceId},signal}))});
 return <section aria-label="Workspace overview"><header className="section-header"><div><h1>Workspace overview</h1>
  <p>Submission activity and current run records for this workspace.</p></div><button disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh overview</button></header>
  {query.isPending&&<p role="status">Loading workspace overview…</p>}
  {query.isError&&<p role="alert">Workspace overview unavailable. Refresh to retry; counts are unknown.</p>}
  {!query.isError&&query.data&&<Overview value={query.data} />}
 </section>;
}
function Overview({value}:{value:Snapshot}){
 const c=value.counts;
 return <><p>Snapshot <time dateTime={value.generatedAt}>{value.generatedAt}</time>. Refresh for current values; active records do not prove engine liveness.</p>
  <dl><dt>Folders (including workspace root)</dt><dd>{c.folders}</dd><dt>Suites</dt><dd>{c.suites}</dd><dt>All run records</dt><dd>{c.runs}</dd>
   <dt>Submitted in last 24 hours</dt><dd>{c.submitted24h}</dd><dt>Failed outcomes among those submissions</dt><dd>{c.failed24h}</dd>
   <dt>Queued</dt><dd>{c.queued}</dd><dt>Dispatching</dt><dd>{c.dispatching}</dd><dt>Active records</dt><dd>{c.active}</dd>
   <dt>Finalizing</dt><dd>{c.finalizing}</dd><dt>Finished</dt><dd>{c.finished}</dd><dt>Cancelled</dt><dd>{c.cancelled}</dd><dt>Execution errors</dt><dd>{c.errored}</dd></dl>
  <h2>Active run records</h2><RunLinks value={value} rows={value.active} empty="No active run records at this snapshot." />
  {value.activeHasMore&&<p>Showing the 20 most recently submitted active records. Open Runs for paginated history.</p>}
  <h2>Recent submissions</h2><RunLinks value={value} rows={value.recent} empty="No runs submitted in this workspace yet." />
  <p><Link to={routes.runs(value.scope.organizationId,value.scope.workspaceId)}>All runs</Link></p>
  <details><summary>Hourly submission activity (24 hours)</summary><p>UTC intervals include their start and exclude their end.</p>
   <table><caption>Submissions by requested time</caption><thead><tr><th>From (UTC)</th><th>To (UTC)</th><th>Submitted</th></tr></thead>
    <tbody>{value.activity.map(bucket=><tr key={bucket.from}><td>{bucket.from}</td><td>{bucket.to}</td><td>{bucket.count}</td></tr>)}</tbody></table>
  </details>
 </>;
}
function RunLinks({value,rows,empty}:{value:Snapshot;rows:readonly OverviewRun[];empty:string}){
 if(!rows.length)return <p>{empty}</p>;
 return <ul>{rows.map(row=><li key={row.id}><Link to={routes.run(value.scope.organizationId,value.scope.workspaceId,row.id)}>{row.id}</Link>
  {' '}<time dateTime={row.requestedAt}>{row.requestedAt}</time> · {row.state} · {row.outcome}</li>)}</ul>;
}
