import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SettingsScope,WorkspaceScope,RetentionTraversalPage,RetentionPreview } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { routes } from '../../app/routes.js';
import { useRetentionCommand } from './useCommand.js';
import { SnapshotSummary } from './Preview.js';
import './retention.css';
interface Props {readonly scope:Exclude<SettingsScope,WorkspaceScope>;readonly settingsId:string;readonly version:number}
export function ParentRetentionControls(props:Props){
 const [open,setOpen]=useState(false);
 return <section className="retention-panel" aria-label="Workspace retention traversal">
  <button onClick={()=>setOpen(value=>!value)}>{open?'Close workspace traversal':'Manage workspace retention'}</button>
  {open&&<ParentScan key={JSON.stringify(props.scope)} {...props}/>}
 </section>;
}
function ParentScan({scope,settingsId,version}:Props){
 const api=useApi();const command=useRetentionCommand(JSON.stringify(scope));const [page,setPage]=useState<RetentionTraversalPage|null>(null);
 function preview(continuing=false){
  const cursor=continuing?page?.nextCursor:null;if(continuing&&!cursor)return;
  const body={scope,requestId:crypto.randomUUID(),settingsId:continuing?page!.settingsId:settingsId,expectedVersion:continuing?page!.settingsVersion:version,page:{limit:100,...(cursor?{cursor}:{})}};
  if(scope.kind==='installation')command.start(signal=>api.previewInstallationRetention({body,signal}),setPage);
  else command.start(signal=>api.previewOrganizationRetention({params:{organizationId:scope.organizationId},body,signal}),setPage);
 }
 return <><h2>Preview workspace retention</h2><p>This is a live, partial scan. Each workspace keeps its own policy and budget. New workspaces may require a fresh scan.</p>
  <button disabled={command.blocked} onClick={()=>preview()}>{page?'Start fresh workspace scan':'Preview workspaces'}</button>
  {page&&<><p>Coverage: live / partial · captured {page.capturedAt}.</p>
   {page.workspace?<WorkspacePreview preview={page.workspace}/>:<p>No workspace remains in this scan. This empty result is not stored and has no replay guarantee.</p>}
   {page.nextCursor?<button disabled={command.blocked} onClick={()=>preview(true)}>Preview next workspace window</button>:<p>The scan reached its horizon. This does not establish complete coverage.</p>}
  </>}
  {command.message&&<div role="alert"><p>{command.message}</p>{command.unknown&&<button disabled={command.pending} onClick={command.retry}>Retry identical traversal request</button>}</div>}
  <p>Apply each captured batch explicitly in its workspace. Applying a batch can make its remaining workspace cursor stale; start a fresh scan if settings or history changed.</p>
 </>;
}
function WorkspacePreview({preview}:{preview:RetentionPreview}){
 if(preview.scope.kind!=='workspace')return <p role="alert">The workspace preview is unavailable.</p>;
 const path=routes.workspaceSettings(preview.scope.organizationId,preview.scope.workspaceId)+`?retentionBatch=${preview.snapshotId}`;
 return <><p>Workspace {preview.scope.workspaceId} · batch {preview.snapshotId}</p><SnapshotSummary preview={preview}/><Link to={path}>Open batch in workspace</Link></>;
}
