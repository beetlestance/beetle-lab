import {reconcileExport} from './step.js';
import type {ExportRuntime,ExportRuntimeOptions} from './types.js';
export type {ExportRuntime,ExportRuntimeOptions} from './types.js';
/** Bounded discovery over shared queue order; owns no connection, files or transfers. */
class Exports implements ExportRuntime {
 private readonly abort=new AbortController();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private scanner:Promise<void>|undefined;
 private readonly active=new Map<string,Promise<void>>();
 private after=0;
 private closing:Promise<void>|undefined;
 private notification:Promise<void>|undefined;
 private failure:{error:unknown}|undefined;
 constructor(private readonly options:ExportRuntimeOptions){}
 start():void{this.turn();}
 private turn():void{
  if(this.abort.signal.aborted)return;
  this.timer=undefined;
  this.scanner=Promise.resolve().then(()=>this.scan()).catch(error=>this.fail(error)).finally(()=>{
   this.scanner=undefined;if(!this.abort.signal.aborted)this.timer=setTimeout(()=>this.turn(),this.options.intervalMs??250);
  });
 }
 private async scan():Promise<void>{
  if(this.active.size>=2)return;
  const page=await this.options.executions.scan({limit:8,after:this.after});
  if(this.abort.signal.aborted)return;
  if(page.length===0){this.after=0;return;}
  for(const candidate of page){
   if(this.active.size>=2)break;this.after=candidate.order;
   if(this.active.has(candidate.key.id))continue;
   const original=Promise.resolve().then(()=>reconcileExport(this.options,candidate.key,this.abort.signal))
    .catch(error=>this.fail(error)).finally(()=>this.active.delete(candidate.key.id));
   this.active.set(candidate.key.id,original);
  }
 }
 private fence():void{this.abort.abort();clearTimeout(this.timer);this.timer=undefined;}
 private fail(error:unknown):void{
  if(this.failure)return;this.failure={error};this.fence();
  this.notification=Promise.resolve().then(()=>this.options.onFailure(error)).catch(notification=>{
   this.failure={error:new AggregateError([error,notification],'Export failure notification failed')};
  });
 }
 close():Promise<void>{
  if(this.closing)return this.closing;this.fence();
  this.closing=this.drain();return this.closing;
 }
 private async drain():Promise<void>{
  await this.scanner;await Promise.all([...this.active.values()]);await this.notification;
  if(this.failure)throw this.failure.error;
 }
}
export function startExportRuntime(options:ExportRuntimeOptions):ExportRuntime {
 const interval=options.intervalMs??250;
 if(!Number.isSafeInteger(interval)||interval<25||interval>60000)throw new Error('Invalid export interval');
 const runtime=new Exports(options);runtime.start();return runtime;
}
