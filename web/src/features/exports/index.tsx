import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {SuiteRevision} from '@beetle/contracts/api';
import {useApi,readResult} from '../../app/api.js';
import {queryKeys} from '../../app/queries.js';
import {QueryState} from '../../components/QueryState.js';
import {usePage,Pagination} from '../../components/Pagination.js';
import {ExportForm} from './Form.js';
import {ExportJobView,exportTerminal} from './Job.js';
export function ExportSavedRevision({revision}:{revision:SuiteRevision}){
 return <ExportPanel key={`${revision.scope.organizationId}/${revision.scope.workspaceId}/${revision.id}`} revision={revision}/>;
}
function ExportPanel({revision}:{revision:SuiteRevision}){
 const api=useApi();const client=useQueryClient();const [open,setOpen]=useState(false);const [selected,select]=useState<string|null>(null);
 const {organizationId,workspaceId}=revision.scope;const params={organizationId,workspaceId};const root=queryKeys.exports(organizationId,workspaceId);const page=usePage(root);
 const profiles=useQuery({queryKey:[...root,'profiles'],queryFn:({signal})=>readResult(api.getExportProfiles({params,signal})),enabled:open});
 const settings=useQuery({queryKey:queryKeys.workspaceSettings(organizationId,workspaceId),queryFn:({signal})=>readResult(api.getWorkspaceSettings({params,signal})),enabled:open});
 const history=useQuery({queryKey:[...root,'page',page.cursor],queryFn:({signal})=>readResult(api.listExports({params,query:page.query,signal})),enabled:open,
  refetchInterval:query=>query.state.status!=='error'&&query.state.data?.items.some(job=>!exportTerminal(job.state))?2000:false});
 const detail=useQuery({queryKey:queryKeys.export(organizationId,workspaceId,selected??''),enabled:open&&selected!==null,
  queryFn:({signal})=>readResult(api.getExport({params:{...params,exportId:selected!},signal})),
  refetchInterval:query=>query.state.status!=='error'&&query.state.data&&!exportTerminal(query.state.data.state)?1000:false});
 useEffect(()=>()=>{
  void client.cancelQueries({queryKey:root,type:'inactive'});client.removeQueries({queryKey:root,type:'inactive'});
 },[client,organizationId,workspaceId]);
 return <section className="suite-editor"><button onClick={()=>setOpen(value=>!value)} aria-expanded={open}>Standalone script exports</button>
  {open&&<><h3>Standalone script exports</h3><QueryState query={profiles}>{data=>data.profiles.length===0?<p>No offline export engine is configured for this installation.</p>:
   <QueryState query={settings}>{value=><ExportForm revision={revision} profiles={data.profiles} settings={value} created={select}/>}</QueryState>}</QueryState>
   <h4>Workspace export history</h4><button disabled={history.isFetching} onClick={()=>void history.refetch()}>Refresh exports</button>
   <QueryState query={history}>{data=><><ul>{data.items.map(job=><li key={job.id}><button onClick={()=>select(job.id)}>{job.state} · {job.id}</button></li>)}</ul>
    {!data.items.length&&<p>No exports yet.</p>}<Pagination page={page} next={data.nextCursor}/></>}</QueryState>
   {selected&&<><button disabled={detail.isFetching} onClick={()=>void detail.refetch()}>Refresh selected export</button><QueryState query={detail}>{job=><ExportJobView key={job.id} job={job}/>}</QueryState></>}
  </>}
 </section>;
}
