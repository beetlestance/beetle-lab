import {useId,useState} from 'react';
import type {RunMetricSeries} from '@beetle/contracts/api';
import {dropped,planning} from './model.js';
import type {Coverage} from './model.js';
interface Source {rows:readonly RunMetricSeries[];coverage:Coverage}
export function DroppedLoad({rows,coverage,scope}:{scope:'live window'|'published source'}&Source){
 const count=dropped(rows);
 if(count===null)return <p>Dropped-iteration signal is not available in this displayed {scope==='live window'?'window':'catalogue page'}; this does not mean zero drops.</p>;
 if(count===0)return <p>0 dropped iterations recorded in this {scope}. {coverage!=='complete'?'Upstream coverage is incomplete or unknown.':''}</p>;
 return <aside className="notice" role="status"><h3>Dropped load</h3><p>{coverage==='complete'?'':'At least '}{count.toLocaleString()} dropped iterations observed in this {scope}.</p>
  <p>Arrival-rate scenarios can run out of free VUs; iteration-count scenarios can reach maxDuration. Check the executor, target latency and load-generator pressure before raising limits.</p>
 </aside>;
}
export function RecordedLoadAdvice({rows,coverage}:Source){
 const id=useId();const [rate,setRate]=useState('');const [headroom,setHeadroom]=useState('20');const plan=planning(rows,coverage,rate,headroom);
 return <section aria-labelledby={id}><h3 id={id}>Load guidance</h3><DroppedLoad rows={rows} coverage={coverage} scope="published source" />
  <details><summary>Arrival-rate VU planning heuristic</summary>
   <p>Uses the recorded iteration median, including iteration work/waits; HTTP RPS and request latency are not substitutes.</p>
   <label>Desired iterations per second<input type="number" min="0" max="1000000" step="any" value={rate} onChange={event=>setRate(event.target.value.slice(0,16))} /></label>
   <label>Headroom (%)<input type="number" min="0" max="500" step="any" value={headroom} onChange={event=>setHeadroom(event.target.value.slice(0,16))} /></label>
   {plan.status==='ready'?<><output aria-label="Candidate VU allocation">Candidate preAllocatedVUs: {plan.vus.toLocaleString()} VUs (heuristic).</output>
    <p>Estimated iteration median {plan.median.estimate.toLocaleString()} ms; bounds {plan.median.lower.toLocaleString()}–{plan.median.upper.toLocaleString()} ms; {plan.median.count.toLocaleString()} samples.</p>
    <p>Formula: ceil(median seconds × desired iterations/second × (1 + headroom/100)).</p></>:<p>{message(plan.status)}</p>}
   <p>This is a planning estimate, not guaranteed capacity. Try a small run and check generator CPU/RAM and target slowdown. It does not change the suite or its budget.</p>
  </details>
 </section>;
}
function message(status:Exclude<ReturnType<typeof planning>['status'],'ready'>):string{
 switch(status){
  case 'coverage':return 'A numeric estimate needs complete recorded-source coverage.';
  case 'missing':return 'Positive iteration-duration statistics are not available in this catalogue page.';
  case 'input':return 'Enter a positive rate up to 1,000,000 and headroom from 0 to 500%.';
  case 'overflow':return 'The estimate exceeds the safe numeric range; no allocation is suggested.';
 }
}
