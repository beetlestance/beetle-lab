import type {ApiOperation} from '../generated/operations.js';
import type {CreateExportRequest,ExportJob,ExportJobPage} from '../generated/types.js';
import type {PreparedInput} from './input.js';
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export function exportRequestMatches(operation:ApiOperation,input:PreparedInput):boolean {
 return operation.name!=='createExport'||same((input.body as unknown as CreateExportRequest).revisionId,input.params.revisionId!);
}
function validJob(job:ExportJob):boolean {
 if(job.state==='ready')return job.artifact!==null&&job.reason===null;
 if(job.state==='cancelled')return job.cancellationRequested&&job.reason==='cancelled';
 if(job.state==='failed'||job.state==='unknown')return job.reason!==null;
 return job.artifact===null;
}
function creationMatches(input:PreparedInput,job:ExportJob):boolean {
 const request=input.body as unknown as CreateExportRequest;
 return same(job.revisionId,request.revisionId)&&job.sourceProfileId===request.engineProfile
  && bodyMatches(request,job)&&initialJob(job);
}
function bodyMatches(request:CreateExportRequest,job:ExportJob):boolean {
 return Object.entries(request.budget).every(([key,value])=>job.budget[key as keyof ExportJob['budget']]===value)
  && job.executionPolicy.mode===request.executionPolicy.mode&&job.executionPolicy.preferIdle===request.executionPolicy.preferIdle
  && job.options.scriptTimeoutMs===request.options.scriptTimeoutMs&&job.options.maximumBuildBytes===request.options.maximumBuildBytes;
}
function initialJob(job:ExportJob):boolean {
 return job.version===1&&job.state==='queued'&&!job.cancellationRequested&&job.reason===null;
}
/** Scope and JSON schema checks precede these purpose-specific intent checks. */
export function exportOwnership(operation:ApiOperation,input:PreparedInput,value:unknown):boolean {
 if(operation.response==='ExportJobPage')return (value as ExportJobPage).items.every(validJob);
 if(operation.response!=='ExportJob')return true;const job=value as ExportJob;
 return validJob(job)&&(operation.name!=='createExport'||creationMatches(input,job))
  && (operation.name!=='cancelExport'||job.cancellationRequested||['ready','failed','cancelled'].includes(job.state));
}
