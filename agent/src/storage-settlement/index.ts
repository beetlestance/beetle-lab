import { captureSettlementRequest } from '@beetle/contracts/output-settlement';
import type { SettlementReply } from '@beetle/contracts/output-settlement';
import { cleanupAccess } from '../cleanup-access/index.js';
import { captureWindow,checkWindow } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import { StorageSettlementError } from './types.js';
import type { Entry,Execution,SettlementOptions,SettlementWork } from './types.js';
export { StorageSettlementError } from './types.js';
export type { SettlementWork } from './types.js';
const owners=new WeakMap<object,StorageSettlement>();
function rejected(error:unknown):SettlementWork{
 const result=Promise.reject<SettlementReply>(error);const settled=Promise.reject<void>(error);
 void result.catch(()=>{});void settled.catch(()=>{});return{result,settled};
}
/** Owns preflight, removable local drain and issued settlement through actual carrier close. */
export class StorageSettlement {
 private readonly entries=new Set<Entry>();private closed=false;private closing?:Promise<void>;
 constructor(private readonly options:SettlementOptions){
  if(owners.has(options.journal.retirements))throw new StorageSettlementError('capacity');
  owners.set(options.journal.retirements,this);
 }
 settle(input:unknown,raw:Operation):SettlementWork{
  if(this.closed)return rejected(new StorageSettlementError('closed'));
  if(this.entries.size>=2)return rejected(new StorageSettlementError('capacity'));
  const entry:Entry={uncertain:false,issued:false,cancelled:false};this.entries.add(entry);
  let execution:Execution;
  try{const operation=captureWindow(raw);execution={entry,operation,request:captureSettlementRequest(input)};}
  catch{this.entries.delete(entry);return rejected(new StorageSettlementError('invalid_input'));}
  const result=Promise.resolve().then(()=>this.execute(execution)).finally(()=>{
   entry.stop?.();
   if(!entry.uncertain){entry.fence?.release();this.entries.delete(entry);}
  });
  const settled=result.then(()=>undefined);void result.catch(()=>{});void settled.catch(()=>{});
  const work=Object.freeze({result,settled});entry.work=work;return work;
 }
 private cancel(entry:Entry):void{
  entry.cancelled=true;if(entry.issued||!entry.fence)return;
  entry.fence.cancel();delete entry.fence;
 }
 private async execute({entry,request,operation}:Execution):Promise<SettlementReply>{
  const cancel=()=>this.cancel(entry);const timer=setTimeout(cancel,Math.max(0,operation.deadline-performance.now()));
  operation.signal?.addEventListener('abort',cancel,{once:true});
  entry.stop=()=>{clearTimeout(timer);operation.signal?.removeEventListener('abort',cancel);};
  const check=()=>{checkWindow(operation,this.closed||entry.cancelled);};
  check();
  try{await this.options.journal.settlements.preflight(request);}
  catch(error){await this.joinFailure(entry);throw error;}
  check();entry.fence=cleanupAccess(this.options.journal.retirements).reserve(request.retirement);
  const observation=await entry.fence.drain();check();
  // No asynchronous gap between the last budget check and the client's synchronous carrier claim.
  entry.issued=true;
  try{return await this.options.journal.settlements.settle(observation,request);}
  catch(error){await this.joinFailure(entry);throw error;}
 }
 private async joinFailure(entry:Entry):Promise<void>{
  try{await this.options.journal.settlements.settleCarrier();}
  catch(error){entry.uncertain=true;throw error;}
 }
 status(){return Object.freeze({retained:this.entries.size,closed:this.closed});}
 stop():void{this.closed=true;for(const entry of this.entries)this.cancel(entry);}
 close():Promise<void>{
  if(this.closing)return this.closing;this.stop();
  this.closing=Promise.resolve().then(async()=>{
   await Promise.allSettled([...this.entries].map(entry=>entry.work?.settled));
   if(this.entries.size)throw new StorageSettlementError('unavailable');
  });return this.closing;
 }
}
