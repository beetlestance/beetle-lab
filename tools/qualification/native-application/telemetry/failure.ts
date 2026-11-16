import {record} from '../../resources/values.js';
const phases=['build','setup','trials','evidence'];
const codes=['EACCES','EPERM','ENOENT','ENOSPC','ETIMEDOUT','ECONNREFUSED','ERR_ASSERTION'];
const hints=[['Qualification startup marker deadline','startup-marker'],['Benchmark resource readiness gate missed','resource-readiness'],
 ['Component reported failed drain or execution','component-failed'],['Compiled bootstrap must contain','bootstrap-content'],
 ['Native benchmark or observer failed','native-or-observer'],['invalid_json','report-json'],['Qualification telemetry assembly failed','assembly-startup'],['Qualification telemetry bootstrap failed','identity-bootstrap']] as const;
function componentFacts(input:unknown){
 const component=input?record(input):null;
 return {componentAvailable:component!==null,componentPassed:component?.status==='passed',orderlyDrained:component?.orderlyDrained===true,
  completedTrials:Array.isArray(component?.results)?Math.min(component.results.length,10):0};
}
function originalStatuses(input:unknown){
 return Array.isArray(input)?input.slice(0,2).map(item=>record(item).status==='fulfilled'?'fulfilled':'rejected'):[];
}
/** Diagnostic hints only. No arbitrary message, path, scope ID or partial success. */
export function failureFacts(input:unknown,componentInput:unknown,startupInput:unknown,revision:string){
 try{
  const row=record(input);if(row.sourceRevision!==revision||!['amd64','arm64'].includes(String(row.architecture)))return null;
  const results=record(row.results);const component=componentInput?record(componentInput):null;
  const texts=[results.parentFailure,results.agentLogs,component?.failure,...(Array.isArray(results.nativeOriginals)?results.nativeOriginals.map(item=>record(item).error):[])].filter((v):v is string=>typeof v==='string'&&v.length<=16384);
  const text=texts.join('\n');const startup=startupInput?record(startupInput):null;
  return {phase:typeof row.phase==='string'&&phases.includes(row.phase)?row.phase:'unavailable',cleanupVerified:row.cleanupVerified===true,
   ...componentFacts(component),originalStatuses:originalStatuses(results.nativeOriginals),
   errorCodes:codes.filter(code=>new RegExp('\\b'+code+'\\b').test(text)),hints:hints.filter(([needle])=>text.includes(needle)).map(([,hint])=>hint),
   readinessDiagnosticAvailable:startup!==null};
 }catch{return null;}
}
