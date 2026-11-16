import {exportContentPath} from '@beetle/contracts/api';
import type {ExportJob} from '@beetle/contracts/api';
import {useExportWrite} from './useWrite.js';
export const exportTerminal=(state:ExportJob['state'])=>['ready','failed','cancelled'].includes(state);
export function ExportJobView({job}:{job:ExportJob}){
 const write=useExportWrite();const params={organizationId:job.scope.organizationId,workspaceId:job.scope.workspaceId,exportId:job.id};
 return <article><h4>Export {job.id}</h4><p role="status">{job.state}{job.reason?` — ${job.reason}`:''}</p>
  <p>Saved revision: {job.revisionId}</p>
  {job.artifact&&<><p>{job.artifact.bytes} bytes · SHA-256 {job.artifact.sha256}</p><a href={exportContentPath(params)} download="suite.js">Download standalone script</a></>}
  {!exportTerminal(job.state)&&<><button disabled={write.pending||write.unknown||job.cancellationRequested||write.id!==null} onClick={()=>void write.send({kind:'cancel',params,body:{scope:job.scope,requestId:crypto.randomUUID()}})}>Cancel export</button>
   {job.cancellationRequested&&<p>Cancellation requested; waiting for execution and output custody to settle.</p>}</>}
  {write.message&&<p role="alert">{write.message}</p>}{write.unknown&&<button disabled={write.pending} onClick={()=>void write.send()}>Replay export cancellation</button>}
 </article>;
}
