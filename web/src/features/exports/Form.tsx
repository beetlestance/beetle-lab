import {useState} from 'react';
import type {SuiteRevision,WorkspaceSettings} from '@beetle/contracts/api';
import {budgetFields,captureRequest,initialValues} from '../execution-request/index.js';
import {useExportWrite} from './useWrite.js';
export function ExportForm({revision,settings,profiles,created}:{revision:SuiteRevision;settings:WorkspaceSettings;profiles:readonly string[];created:(id:string)=>void}){
 const [values,setValues]=useState(()=>({...initialValues(settings),profile:profiles.includes(settings.effective.runDefaults.engineProfile.value)?settings.effective.runDefaults.engineProfile.value:profiles[0]??''}));
 const [maximum,setMaximum]=useState('1048576');const [timeout,setTimeout]=useState('180000');const [error,setError]=useState('');const write=useExportWrite();
 const locked=write.pending||write.unknown;
 function submit(){
  if(locked)return;
  try{
   const base=captureRequest({revision,settings,values,requestId:crypto.randomUUID()});
   const maximumBuildBytes=positive(maximum,67108864,'Maximum script size');const scriptTimeoutMs=positive(timeout,172800000,'Script timeout');
   if(maximumBuildBytes+73728>base.budget.outputBytes)throw new Error('Output budget must cover the maximum script size plus 73,728 bytes for its result.');
   setError('');void write.send({kind:'create',body:{...base,options:{maximumBuildBytes,scriptTimeoutMs}}});
  }catch(failure){setError(failure instanceof Error?failure.message:'Check export settings.');}
 }
 return <section aria-label="Standalone script settings"><p>Build a standalone k6 script offline. Generation uses the shared execution pool and does not send test traffic.</p>
  <form onSubmit={event=>{event.preventDefault();submit();}}><fieldset disabled={locked}>
   <legend>Export settings</legend><label>Resource profile<select value={values.profile} onChange={event=>setValues({...values,profile:event.target.value})}>
    {profiles.map(profile=><option key={profile}>{profile}</option>)}</select></label>
   {budgetFields.map(([key,label])=><label key={key}>{label}<input required inputMode="numeric" maxLength={16} value={values.budget[key]}
    onChange={event=>setValues({...values,budget:{...values.budget,[key]:event.target.value}})}/></label>)}
   <label>Maximum script size (bytes)<input required inputMode="numeric" maxLength={16} value={maximum} onChange={event=>setMaximum(event.target.value)}/></label>
   <label>Generated script timeout (milliseconds)<input required inputMode="numeric" maxLength={16} value={timeout} onChange={event=>setTimeout(event.target.value)}/></label>
   <label>Execution mode<select value={values.mode} onChange={event=>{if(event.target.value==='parallel'||event.target.value==='isolated')setValues({...values,mode:event.target.value});}}>
    <option value="parallel">Parallel</option><option value="isolated">Isolated</option></select></label>
   <label><input type="checkbox" checked={values.preferIdle} onChange={event=>setValues({...values,preferIdle:event.target.checked})}/>Prefer idle capacity</label>
   <button type="submit">Generate standalone script</button>
  </fieldset></form>
  {write.pending&&<p role="status">Submitting export…</p>}{(error||write.message)&&<p role="alert">{error||write.message}</p>}
  {write.unknown&&<><p>The outcome is unknown. Check export history or replay the identical request.</p><button disabled={write.pending} onClick={()=>void write.send()}>Replay export request</button></>}
  {write.id&&<button onClick={()=>created(write.id!)}>View submitted export</button>}
 </section>;
}
function positive(text:string,maximum:number,label:string):number{
 const value=Number(text);if(!/^[1-9][0-9]*$/.test(text)||!Number.isSafeInteger(value)||value>maximum)throw new Error(`${label} must be a whole number from 1 to ${maximum}.`);return value;
}
