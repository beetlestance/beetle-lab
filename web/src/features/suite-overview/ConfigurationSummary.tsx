import type {SuiteRevision} from '@beetle/contracts/api';
import {configurationSummary} from './configuration.js';
export function ConfigurationSummary({revision}:{revision:SuiteRevision}){
 const value=configurationSummary(revision.config);
 return <section aria-label="Saved configuration overview"><h3>Saved configuration overview</h3>
  <p>Revision {revision.ordinal}. Configured target origin: <span>{value.origin??'Unknown'}</span>.</p>
  <p>Configured schedule only; these values are not measured duration or a whole-run estimate. Engine validation is separate.</p>
  {!value.available?<p>Configured schedule unavailable.</p>:<ul>{value.rows.map((row,index)=><li key={index}>{row?<>{row.executor} — {row.timing}
   {row.offset!==null&&<>; starts after {row.offset}</>}{row.grace!==null&&<>; graceful stop {row.grace}</>}</>:'Configured scenario unavailable'}</li>)}</ul>}
  {value.remaining>0&&<p>{value.remaining} more configured scenarios. Open the revision JSON for the complete plan.</p>}
 </section>;
}
