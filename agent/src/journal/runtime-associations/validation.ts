import type {DatabaseSync} from 'node:sqlite';
import {encodeCanonicalJson} from '@beetle/contracts';
import {captureNamespaceIntent,captureTaskNamespaceIntent} from '../../staging-namespace/index.js';
import type {Reservation} from '../../admission/index.js';
import type {RuntimeAssociation} from '../../runtime-association/index.js';
import {bindRuntimeAssociation,runtimeAssociationBytes} from '../../runtime-association/index.js';
import {captureRetirementIntent} from '../../retirement-values/index.js';
function text(input:unknown,maximum:number):string{
 if(typeof input!=='string'||Buffer.byteLength(input)>maximum)throw Error('Invalid association metadata');return input;
}
export function registerRuntimeAssociationValidation(db:DatabaseSync):void{
 db.function('runtime_association_matches',{deterministic:true},(input,retirement,reservation,installed,task)=>{
  try{
   const raw=text(input,runtimeAssociationBytes);const intent=captureRetirementIntent(JSON.parse(text(retirement,4096)) as unknown);
   const value=bindRuntimeAssociation(JSON.parse(raw) as unknown,intent);const original=JSON.parse(text(reservation,32768)) as Reservation;
   const root=captureNamespaceIntent(JSON.parse(text(installed,8192)) as unknown);const staged=captureTaskNamespaceIntent(JSON.parse(text(task,8192)) as unknown);
   if(root.root.daemonId!==value.daemonId||`${staged.runtimeName}-live`!==value.mailboxName)return 0;
   if(raw!==encodeCanonicalJson(value,runtimeAssociationBytes))return 0;
   return reservationMatches(original,value)?1:0;
  }catch{return 0;}
 });
}

function reservationMatches(original:Reservation,value:RuntimeAssociation):boolean{
 return original.status==='released'&&original.runtimeId===value.runtimeId&&original.specDigest===value.specDigest&&original.attemptId===value.original.attemptId&&original.organizationId===value.original.organizationId&&original.workspaceId===value.original.workspaceId&&original.generation===value.original.generation;
}
