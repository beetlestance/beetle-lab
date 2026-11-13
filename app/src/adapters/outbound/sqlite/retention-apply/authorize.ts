import { encodeCanonicalJson } from '@beetle/contracts';
import { captureDeletionReply } from '../output-deletion/index.js';
import type { prepareRetentionApply } from './facts.js';
type Child=ReturnType<typeof prepareRetentionApply>['children'][number];
/** Pure comparison only; the SQL function obtains its child from the private live frame. */
function receiptAllowed(child:Child,binding:unknown,body:unknown):number{
 if(binding!==child.receiptBinding||typeof body!=='string'||Buffer.byteLength(body)>4096)return 0;
 try{
  const summary=captureDeletionReply({kind:'beginOutputDeletion',command:child.command},JSON.parse(body) as unknown);
  return encodeCanonicalJson(summary,4096)===child.receiptCanonical?1:0;
 }catch{return 0;}
}
export function childWriteAllowed(child:Child,kind:unknown,binding:unknown,body:unknown):number{
 if(kind==='intent')return binding===child.intentBinding&&body===null?1:0;
 if(kind==='file')return typeof binding==='string'&&child.fileBindings.has(binding)&&body===null?1:0;
 return kind==='receipt'?receiptAllowed(child,binding,body):0;
}
