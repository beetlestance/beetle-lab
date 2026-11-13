import { guardedNoTaskIO } from './io.js';
import { nativeCustody } from '../collection/native-custody/index.js';
import { OutputLifetime,nodePorts,OutputFailure } from '../collection/output/index.js';
import { inventoryPorts } from '../task-inventory/index.js';
import { cleanupAccess } from '../cleanup-access/index.js';
import type { CleanupLease } from '../cleanup-access/index.js';
import type { ProducerBarrier } from '../producer-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import { captureWindow } from '../runtime-retirement/index.js';
import { makeNoTaskReceipt } from '../no-task-receipt-values/index.js';
import type { StoredNoTaskReceipt } from '../no-task-receipt-values/index.js';
import { currentNoTask,noTaskScope } from './authority.js';
import { observeNoTask } from './native.js';
import { mintNoTaskObservation } from './observation.js';
import type { NoTaskReceiptOptions,NoTaskNativePorts,NoTaskWork } from './types.js';
export type { NoTaskReceiptOptions,NoTaskNativePorts,NoTaskWork } from './types.js';
export type { NoTaskObservation } from './observation.js';
export { claimNoTaskObservation } from './observation.js';
interface Entry {uncertain:boolean;cancelled:boolean;readonly abort:AbortController;access?:CleanupLease;work?:NoTaskWork;stored?:StoredNoTaskReceipt;closing?:Promise<void>}
const activeOwners=new Set<NoTaskReceipt>();
function refused(reason:'busy'|'closed'='busy'):NoTaskWork{const done=Promise.resolve();return{result:Promise.resolve({ok:false,reason}),quiesced:done,close:()=>done};}
/** Native cleanup ownership includes actual descriptor close and the issued receipt carrier. */
export class NoTaskReceipt {
 private readonly entries=new Set<Entry>();private closed=false;private closing:Promise<void>|undefined;
 private readonly options:NoTaskReceiptOptions;
 constructor(options:NoTaskReceiptOptions){this.options=Object.freeze({...options});}
 finalize(token:ProducerBarrier,input:Operation):NoTaskWork{return this.finalizeWithPorts(token,input,{filesystem:inventoryPorts,timing:nodePorts});}
 /** Trusted fault seam; production uses the public finalize path. */
 finalizeWithPorts(token:ProducerBarrier,input:Operation,ports:NoTaskNativePorts):NoTaskWork{
  if(this.closed)return refused('closed');if(this.entries.size>=2)return refused();const credit=nativeCustody.reserve('cleanup');if(!credit)return refused();
  const entry:Entry={uncertain:false,cancelled:false,abort:new AbortController()};this.entries.add(entry);activeOwners.add(this);credit.own(entry);
  const release=()=>{if(entry.uncertain)return;credit.release();entry.access?.release();this.entries.delete(entry);if(!this.entries.size)activeOwners.delete(this);};
  const life=new OutputLifetime<{readonly ok:true}>(ports.timing,release);
  const io=guardedNoTaskIO(life,()=>{if(this.closed||entry.cancelled)throw new OutputFailure('closed');noTaskScope(this.options,token);});
  const close=()=>{if(entry.closing)return entry.closing;entry.cancelled=true;entry.abort.abort();
   entry.closing=life.public.close().then(()=>{if(entry.uncertain)throw new OutputFailure('io');});return entry.closing;};
  let postClose:(()=>Promise<void>)|undefined;
  const work:NoTaskWork={result:life.public.result.then(value=>value.ok&&entry.stored?{ok:true,stored:entry.stored}:value.ok?{ok:false,reason:'io'}:value),
   quiesced:life.public.quiesced,close};entry.work=work;
  life.start(()=>{
   const window=captureWindow(input);const scope=noTaskScope(this.options,token);credit.bind(scope.directory);
   entry.access=cleanupAccess(this.options.journal.retirements).acquire(scope.key);
   return{deadline:window.deadline,signal:window.signal?AbortSignal.any([window.signal,entry.abort.signal]):entry.abort.signal};
  },async operation=>{
   const scope=await this.metadata(entry,()=>currentNoTask(this.options,token,io));
   postClose=await observeNoTask({scope,io,ports:ports.filesystem,transport:this.options.transport,operation});return{ok:true};
  },async()=>{
   if(!postClose)throw new OutputFailure('io');await postClose();
   const scope=await this.metadata(entry,()=>currentNoTask(this.options,token,io));io.check();
   const binding={request:scope.intent.request,namespaceIdentity:scope.root.namespaceIdentity,taskName:scope.name,daemonId:scope.daemonId,
    root:scope.root.native,markerDigest:scope.root.marker.sha256};const receipt=makeNoTaskReceipt(binding);
   const observation=mintNoTaskObservation({owner:this.options.journal.retirements,binding,receipt,
    open:()=>{try{io.check();return!this.closed&&!entry.cancelled;}catch{return false;}}});
   entry.stored=await this.metadata(entry,()=>this.options.journal.noTaskReceipts.commit(observation));io.check();
  });return work;
 }
 private async metadata<T>(entry:Entry,issue:()=>Promise<T>):Promise<T>{
  try{return await issue();}catch(error){try{await this.options.journal.retirements.settleCarrier();}catch{entry.uncertain=true;}throw error;}
 }
 status(){return Object.freeze({retained:this.entries.size,closed:this.closed});}
 close():Promise<void>{
  if(this.closing)return this.closing;this.closed=true;
  for(const entry of this.entries){entry.cancelled=true;entry.abort.abort();}
  this.closing=Promise.resolve().then(async()=>{
   const outcomes=await Promise.allSettled([...this.entries].map(entry=>entry.work!.close()));
   if(outcomes.some(value=>value.status==='rejected')||this.entries.size)throw new OutputFailure('io');
  });return this.closing;
 }
}
