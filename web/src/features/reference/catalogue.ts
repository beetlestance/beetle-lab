import {encodeJson} from '@beetle/contracts';
import {apiOperations,apiSchemas,apiMessageSchemas} from '@beetle/contracts/api';
export {apiOperations};
export type MessageName=keyof typeof apiMessageSchemas;
export interface SchemaFields {readonly params?:MessageName;readonly query?:MessageName;readonly request?:MessageName;readonly response:MessageName}
function object(value:unknown):value is Readonly<Record<string,unknown>>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
/** Resolve only shipped catalogue references; never fetch a schema URL. */
function definition(name:MessageName):unknown{
 const reference=apiMessageSchemas[name].$ref;const [id,fragment]=reference.split('#',2);
 let value:unknown=apiSchemas.find(schema=>schema.$id===id);
 if(!fragment?.startsWith('/'))throw Error('Unsupported reference pointer');
 for(const key of fragment.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~'))){
  if(!object(value)||!Object.hasOwn(value,key))throw Error('Missing reference definition');value=value[key];
 }
 return value;
}
export function schemaText(name:MessageName):{text:string;compact:boolean}{
 const compact=encodeJson(definition(name),65536);
 // Source JSON is capped before pretty formatting; its bounded depth/size bounds
 // the temporary expansion. Oversized presentation falls back to complete compact JSON.
 const pretty=JSON.stringify(JSON.parse(compact) as unknown,null,2);
 return new TextEncoder().encode(pretty).length<=262144?{text:pretty,compact:false}:{text:compact,compact:true};
}
export function filterOperations(query:string){
 const needle=query.slice(0,128).trim().toLowerCase();
 const matches=apiOperations.filter(row=>`${row.method} ${row.path} ${row.name}`.toLowerCase().includes(needle));
 return {items:matches.slice(0,80),total:matches.length};
}
