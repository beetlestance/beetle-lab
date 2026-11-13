import { ReadAdmission } from '../../components/ReadAdmission.js';
import { useEffect,useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { useApi,readResult } from '../../app/api.js';
import { QueryState } from '../../components/QueryState.js';
import { useRetentionCommand } from './useCommand.js';
import { retentionKey,retentionParams } from './queries.js';
import { RetentionBatch } from './Batch.js';
import './retention.css';
export interface ManualRun {readonly id:string;readonly version:number}
export function RetentionControls({scope,run,initialSnapshotId}:{scope:WorkspaceScope;run?:ManualRun;initialSnapshotId?:string}){
 const [open,setOpen]=useState(initialSnapshotId!==undefined);
 return <section className="retention-panel" aria-label="Run retention">
  <button onClick={()=>setOpen(value=>!value)}>{open?'Close retention controls':run?'Delete this run…':'Manage run retention'}</button>
  {open&&<ReadAdmission><RetentionWorkspace key={`${scope.organizationId}/${scope.workspaceId}/${run?.id??''}`} scope={scope} {...(run?{run}:{})} {...(initialSnapshotId?{initialSnapshotId}:{})}/></ReadAdmission>}
 </section>;
}
function RetentionWorkspace({scope,run,initialSnapshotId}:{scope:WorkspaceScope;run?:ManualRun;initialSnapshotId?:string}){
 const api=useApi();const client=useQueryClient();const identity=JSON.stringify(retentionKey(scope));const command=useRetentionCommand(identity);
 const [selected,setSelected]=useState<string|null>(initialSnapshotId??null);const params=retentionParams(scope);const prefix=retentionKey(scope);
 const settings=useQuery({queryKey:[...prefix,'settings'],queryFn:({signal})=>readResult(api.getWorkspaceSettings({params,signal}))});
 const batches=useQuery({queryKey:[...prefix,'batches'],queryFn:({signal})=>readResult(api.listWorkspaceRetention({params,signal}))});
 useEffect(()=>()=>{const queryKey=JSON.parse(identity) as string[];void client.cancelQueries({queryKey});client.removeQueries({queryKey});},[client,identity]);
 const refresh=()=>{void client.invalidateQueries({queryKey:prefix});};
 function preview(){
  if(!settings.data)return;const body={scope,requestId:crypto.randomUUID(),settingsId:settings.data.id,expectedVersion:settings.data.version};
  if(run){command.start(signal=>api.previewRunDeletion({params:{...params,runId:run.id},body:{...body,runId:run.id,expectedRunVersion:run.version},signal}),value=>{setSelected(value.snapshotId);refresh();});}
  else command.start(signal=>api.previewWorkspaceRetention({params,body:{...body,page:{limit:100}},signal}),value=>{setSelected(value.snapshotId);refresh();});
 }
 return <><h2>{run?'Delete run':'Run retention'}</h2>
  <p>Preview first, then explicitly apply the displayed batch. Estimates are retained logical bytes; cleanup and physical disk reclamation are separate.</p>
  <QueryState query={settings}>{value=><><p>Effective policy: {value.effective.retention.value.mode} · inherited from {value.effective.retention.source.kind}.</p>
   <button disabled={command.blocked} onClick={preview}>{run?'Preview this run deletion':'Preview retention'}</button></>}</QueryState>
  <p>At most eight batches are stored. Discard unused previews or acknowledge completed batches to release their metadata reservation.</p>
  <button disabled={batches.isFetching} onClick={()=>void batches.refetch()}>Refresh batches</button>
  <QueryState query={batches}>{value=><ul aria-label="Saved retention batches">{value.items.map(item=><li key={item.id}><button disabled={command.blocked} onClick={()=>setSelected(item.id)}>{item.kind} · {item.state} · {item.candidateCount} candidates · {item.id}</button></li>)}{value.items.length===0&&<li>No saved batches.</li>}</ul>}</QueryState>
  {command.message&&<div role="alert"><p>{command.message}</p>{command.unknown&&<button disabled={command.pending} onClick={command.retry}>Retry identical retention request</button>}</div>}
  {selected&&<RetentionBatch key={selected} scope={scope} id={selected} command={command} selected={setSelected} changed={refresh} removed={()=>{setSelected(null);refresh();}}/>}
 </>;
}
