import {useQuery} from '@tanstack/react-query';
import {readResult,useApi} from '../../app/api.js';
import {queryKeys} from '../../app/queries.js';
import {OverviewFacts} from '../workspace-overview/index.js';
export function OrganizationOverview({organizationId}:{organizationId:string}){
 const api=useApi();const query=useQuery({queryKey:[...queryKeys.organization(organizationId),'overview'],
  queryFn:({signal})=>readResult(api.getOrganizationOverview({params:{organizationId},signal}))});
 return <section aria-label="Organization overview"><header className="section-header"><div><h1>Organization overview</h1>
  <p>Submission activity and run records across this organization’s workspaces.</p></div>
  <button disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh organization overview</button></header>
  {query.isPending&&<p role="status">Loading organization overview…</p>}
  {query.isError&&<p role="alert">Organization overview unavailable. Refresh to retry; counts are unknown.</p>}
  {!query.isError&&query.data&&<OverviewFacts value={query.data} />}
 </section>;
}
