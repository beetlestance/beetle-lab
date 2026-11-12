import {useId,useMemo,useState} from 'react';
import {apiBinaryOperations} from '@beetle/contracts/api';
import {referenceDownloads} from '../../app/routes.js';
import {filterOperations,schemaText} from './catalogue.js';
import type {MessageName,SchemaFields} from './catalogue.js';
import './reference.css';
const labels={params:'Path parameters',query:'Query',request:'Request body',response:'Successful response'} as const;
export function Reference(){
 const [query,setQuery]=useState('');const [selected,setSelected]=useState('listOrganizations');const filter=useId();
 const page=filterOperations(query);const operation=page.items.find(row=>row.name===selected)??page.items[0];
 return <section><header className="section-header"><div><h1>Public API reference</h1><p>Explore the generated endpoints and schemas shipped with this frontend.</p></div></header>
  <div className="button-row"><a href={referenceDownloads.markdown} download="public-api.md">Download API reference</a>
   <a href={referenceDownloads.catalogue} download="public-api.json">Download schema catalogue</a>
   <a href={referenceDownloads.k6} download="k6-config.json">Download k6 configuration schemas</a>
   <a href={referenceDownloads.skill} download="SKILL.md">Download agent instructions</a></div>
  <p>Save the agent instructions as SKILL.md in your agent’s skill folder. They use this installation’s public HTTP API and matching downloadable contracts.</p>
  <label htmlFor={filter}>Filter JSON operations</label><input id={filter} type="search" maxLength={128} value={query} onChange={event=>setQuery(event.target.value.slice(0,128))} />
  <p role="status">{page.items.length} of {page.total} matching operations.</p>
  {page.items.length===0?<p>No matching operations.</p>:<div className="table-scroll" tabIndex={0} role="region" aria-label="Public API operations">
   <table><caption>Generated public API operations</caption><thead><tr><th scope="col">Method</th><th scope="col">Route</th><th scope="col">Success</th><th scope="col">Schema</th></tr></thead>
    <tbody>{page.items.map(row=><tr key={row.name}><td>{row.method}</td><td><code>{row.path}</code></td><td>{row.successStatus}</td>
     <td><button aria-label={`Inspect ${row.name}`} aria-pressed={row.name===operation?.name} onClick={()=>setSelected(row.name)}>Inspect</button></td></tr>)}</tbody></table></div>}
  {operation&&<section aria-label="Selected operation"><h2>{operation.name}</h2><p><code>{operation.method} {operation.path}</code> · HTTP {operation.successStatus}</p>
   <p>Schema references ($ref) resolve against the downloaded catalogue. Requests also need the installation’s local session and mutation CSRF headers.</p>
   {(Object.keys(labels) as (keyof SchemaFields)[]).map(field=><SchemaSection key={`${operation.name}/${field}`} label={labels[field]} name={(operation as SchemaFields)[field]} />)}
  </section>}
  <BinaryTransfers />
 </section>;
}
function BinaryTransfers(){
 return <section aria-label="Binary transfer reference"><h2>Binary transfers</h2><p>These routes use the local session. Mutations also need the exact Origin and CSRF headers.</p>
  {apiBinaryOperations.map(operation=><details key={operation.name}><summary>{operation.method} {operation.path}</summary>
   <p>{operation.notes}</p><dl><dt>Operation</dt><dd>{operation.name}</dd><dt>Success</dt><dd>HTTP {operation.successStatus} · {operation.response}</dd>
    {'body' in operation&&<><dt>Body size</dt><dd>{operation.body.minimumBytes}–{operation.body.maximumBytes} bytes</dd></>}
    {Object.entries(operation.query).map(([name,value])=><div key={name}><dt>Query · {name}</dt><dd>{value}</dd></div>)}
    {Object.entries(operation.requestHeaders).map(([name,value])=><div key={name}><dt>Header · {name}</dt><dd>{value}</dd></div>)}
    {'integrity' in operation&&<><dt>Integrity metadata</dt><dd>{operation.integrity.metadata}: verify complete bytes and SHA256; ETag is quoted SHA256.</dd></>}
   </dl></details>)}
 </section>;
}
function SchemaSection({label,name}:{label:string;name:MessageName|undefined}){
 const heading=useId();const value=useMemo(()=>{
  if(!name)return null;
  try{return {ok:true as const,...schemaText(name)};}catch{return {ok:false as const};}
 },[name]);
 return <section aria-labelledby={heading}><h3 id={heading}>{label}{name?` · ${name}`:''}</h3>
  {!value&&<p>None.</p>}{value&&!value.ok&&<p role="alert">This schema cannot be shown within the inline limit. Use the downloaded catalogue.</p>}
  {value?.ok&&<>{value.compact&&<p>Large schema shown as complete compact JSON.</p>}<pre className="reference-schema" tabIndex={0} role="region" aria-label={`${label} schema`}>{value.text}</pre></>}
 </section>;
}
