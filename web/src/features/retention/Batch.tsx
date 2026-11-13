import { useQuery,useQueryClient } from '@tanstack/react-query';
import type { RetentionPreview,RetentionBatchStatus,WorkspaceScope } from '@beetle/contracts/api';
import { useApi,readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { QueryState } from '../../components/QueryState.js';
import { retentionKey,retentionParams } from './queries.js';
import type { RetentionCommand } from './useCommand.js';
interface Props {scope:WorkspaceScope;id:string;command:RetentionCommand;changed():void;selected(id:string):void;removed():void}
export function RetentionBatch(props:Props){
 const api=useApi();const params={...retentionParams(props.scope),snapshotId:props.id};const prefix=[...retentionKey(props.scope),props.id];
 const preview=useQuery({queryKey:[...prefix,'preview'],queryFn:({signal})=>readResult(api.getWorkspaceRetentionPreview({params,signal}))});
 const status=useQuery({queryKey:[...prefix,'status'],queryFn:({signal})=>readResult(api.getWorkspaceRetentionStatus({params,signal})),
  refetchInterval:query=>query.state.status==='success'&&query.state.data?.state==='applied'?2000:false,refetchIntervalInBackground:false});
 return <section aria-label="Selected retention batch"><h3>Batch {props.id}</h3>
  <button disabled={preview.isFetching||status.isFetching} onClick={()=>{void preview.refetch();void status.refetch();}}>Refresh batch</button>
  <QueryState query={preview}>{value=><QueryState query={status}>{progress=><BatchView {...props} preview={value} status={progress}/>}</QueryState>}</QueryState>
 </section>;
}
function BatchView({scope,id,command,changed,selected,removed,preview,status}:Props&{preview:RetentionPreview;status:RetentionBatchStatus}){
 const api=useApi();const client=useQueryClient();const params=retentionParams(scope);const expired=Date.parse(preview.expiresAt)<=Date.now();
 function apply(){
  const body={scope,requestId:crypto.randomUUID(),settingsId:preview.settingsId,expectedVersion:preview.settingsVersion,snapshotId:id,snapshotVersion:preview.version,page:{limit:preview.candidates.length}};
  command.start(signal=>api.applyWorkspaceRetention({params,body,signal}),()=>{changed();void client.invalidateQueries({queryKey:queryKeys.runs(scope.organizationId,scope.workspaceId)});});
 }
 function next(){
  if(preview.nextCursor===null)return;const body={scope,requestId:crypto.randomUUID(),settingsId:preview.settingsId,expectedVersion:preview.settingsVersion,page:{limit:100,cursor:preview.nextCursor}};
  command.start(signal=>api.previewWorkspaceRetention({params,body,signal}),value=>{selected(value.snapshotId);changed();});
 }
 function discard(){command.start(signal=>api.discardWorkspaceRetention({params:{...params,snapshotId:id},signal}),()=>removed());}
 return <><p>Scanned {preview.scanned} runs. Estimated retained logical bytes: {preview.estimatedBytes}. Preview expires {preview.expiresAt}.</p>
  <div className="settings-table-wrap"><table><caption>Immutable deletion candidates</caption><thead><tr><th>Run</th><th>Version</th><th>Reason</th><th>Estimated logical bytes</th></tr></thead>
   <tbody>{preview.candidates.map(item=><tr key={item.id}><td>{item.id}</td><td>{item.version}</td><td>{item.reason}</td><td>{item.estimatedBytes}</td></tr>)}</tbody></table></div>
  {preview.protectedExclusions.map(item=><p key={item.reason}>Protected {item.reason}: {item.count}; logical bytes {item.estimatedBytes===null?'unknown':item.estimatedBytes}.</p>)}
  {status.state==='preview'&&<><button disabled={command.blocked||expired||preview.candidates.length===0} onClick={apply}>Apply deletion of {preview.candidates.length} runs</button>
   {preview.nextCursor&&<button disabled={command.blocked||expired} onClick={next}>Preview next window</button>}
   {expired&&<p role="status">This preview expired. Discard it and start a fresh preview.</p>}
   <button disabled={command.blocked} onClick={discard}>Discard this preview</button></>}
  <Progress value={status}/>
  {status.state==='completed'&&<><p>Acknowledgement removes this batch’s status and replay records. Permanent run replay protection remains.</p><button disabled={command.blocked} onClick={discard}>Acknowledge completed batch</button></>}
 </>;
}
function Progress({value}:{value:RetentionBatchStatus}){
 return <section aria-label="Deletion progress"><h4>{value.state}</h4><p>{value.completedCount} of {value.items.length} settled. Confirmed logical credit: {value.refundedLogicalBytes} bytes.</p>
  {value.state==='applied'&&<p>Waiting for authoritative cleanup and settlement confirmation.</p>}
  <ul>{value.items.map(item=><li key={item.deletionId}>{item.runId}: {item.phase}; files absent {item.absentCount??'unknown'} of {item.fileCount??'unknown'}{item.error&&<strong role="alert"> — {item.error}</strong>}</li>)}</ul>
 </section>;
}
