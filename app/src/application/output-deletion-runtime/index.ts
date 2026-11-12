import {OutputByteError} from '../../ports/output-bytes.js';
import type {OutputFileJob} from '../../ports/output-bytes.js';
import type {OutputDeletionSummary} from '../../ports/output-deletion-metadata.js';
import type {OutputDeletionRuntime,OutputDeletionRuntimeOptions} from './types.js';
import {deletionPage} from './values.js';
import {deletionStep,check} from './step.js';
export type {OutputDeletionRuntime,OutputDeletionRuntimeOptions,DeletionProgress} from './types.js';
class Deletions implements OutputDeletionRuntime {
 private readonly abort=new AbortController();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private deadlineTimer:ReturnType<typeof setTimeout>|undefined;
 private original:Promise<void>|undefined;
 private closing:Promise<void>|undefined;
 private notification:Promise<void>|undefined;
 private failure:{error:unknown}|undefined;
 private cursor:string|undefined;
 private current:{summary:OutputDeletionSummary;ordinal:number}|undefined;
 private native:OutputFileJob<unknown>|undefined;
 constructor(private readonly options:OutputDeletionRuntimeOptions){}
 start():void{this.turn();}
 private turn():void{
  if(this.abort.signal.aborted)return;this.timer=undefined;
  this.original=Promise.resolve().then(()=>this.step()).catch(error=>{
   if(error instanceof OutputByteError&&error.code==='busy')return;
   if(this.abort.signal.aborted&&!this.failure)return;
   this.fail(error);
  }).finally(()=>{
   clearTimeout(this.deadlineTimer);this.deadlineTimer=undefined;
   this.original=undefined;
   if(!this.abort.signal.aborted)this.timer=setTimeout(()=>this.turn(),this.options.intervalMs??250);
  });
 }
 private async step():Promise<void>{
  if(this.abort.signal.aborted)return;
  const context={signal:this.abort.signal,deadline:performance.now()+30000,freeSpaceReserveBytes:this.options.freeSpaceReserveBytes};
  this.deadlineTimer=setTimeout(()=>this.fail(Error('Deletion deadline')),Math.max(0,context.deadline-performance.now()));
  if(!this.current){
   const query={limit:1,...(this.cursor?{cursor:this.cursor}:{})};const page=deletionPage(await this.options.metadata.scan(query));
   if(this.abort.signal.aborted)return;check(context);this.cursor=page.nextCursor??undefined;
   if(!page.items[0])return;this.current={summary:page.items[0],ordinal:0};
  }
  const {summary,ordinal}=this.current;this.current.ordinal++;
  if(this.current.ordinal===summary.fileCount)this.current=undefined;
  await deletionStep(this.options,{scope:summary.scope,id:summary.id,runId:summary.runId,ordinal},context,job=>this.own(job));
 }
 private async own<T>(job:OutputFileJob<T>):Promise<T>{
  this.native=job;
  const result=job.result.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  const settled=job.settled.catch(error=>{this.fail(error);return new Promise<never>(()=>{});});
  const value=await result;
  if(!value.ok&&!this.abort.signal.aborted&&!(value.error instanceof OutputByteError&&value.error.code==='busy'))this.fail(value.error);
  await settled;this.native=undefined;
  if(!value.ok)throw value.error;return value.value;
 }
 private fence():void{this.abort.abort();clearTimeout(this.timer);this.timer=undefined;clearTimeout(this.deadlineTimer);this.deadlineTimer=undefined;}
 private fail(error:unknown):void{
  if(this.failure)return;this.failure={error};this.fence();
  this.notification=Promise.resolve().then(()=>this.options.onFailure(error)).catch(cause=>{
   this.failure={error:new AggregateError([error,cause],'Deletion failure notification failed',{cause})};
  });
 }
 close():Promise<void>{
  if(this.closing)return this.closing;this.fence();this.closing=this.drain();return this.closing;
 }
 private async drain():Promise<void>{
  await this.original;await this.notification;if(this.native)throw Error('Unsettled deletion original');
  if(this.failure)throw this.failure.error;
 }
}
/** Shares installed metadata/native owners; creates no intents and refunds no charge. */
export function startOutputDeletionRuntime(options:OutputDeletionRuntimeOptions):OutputDeletionRuntime{
 const interval=options.intervalMs??250;
 if(!Number.isSafeInteger(interval)||interval<25||interval>60000)throw Error('Invalid deletion interval');
 if(!Number.isSafeInteger(options.freeSpaceReserveBytes)||options.freeSpaceReserveBytes<0)throw Error('Invalid deletion reserve');
 const m=options.metadata;const f=options.files;
 const metadata=Object.freeze({scan:m.scan.bind(m),getFile:m.getFile.bind(m),recordPlan:m.recordPlan.bind(m),recordAbsence:m.recordAbsence.bind(m)});
 const files=Object.freeze({prepareRemoval:f.prepareRemoval.bind(f),remove:f.remove.bind(f)});
 const runtime=new Deletions({...options,metadata,files});runtime.start();return runtime;
}
