import assert from 'node:assert/strict';
import type {Metadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
/** Task-only reply fault injection; actual compiled worker commits before interception. */
export function holdMetadataReply(metadata:Metadata,matches:(value:unknown)=>boolean){
 const receive=Reflect.get(metadata,'receive') as (reply:unknown)=>void;
 let resolve!:(value:unknown)=>void;let seen=false;const issued=new Promise<unknown>(done=>{resolve=done;});
 Reflect.set(metadata,'receive',(reply:unknown)=>{
  const value=record(reply);if(!seen&&value?.kind==='result'&&value.ok===true&&matches(value.value)){seen=true;resolve(value.value);return;}
  receive.call(metadata,reply);
 });
 return {issued,restore:()=>{Reflect.set(metadata,'receive',receive);}};
}
export function record(value:unknown):Record<string,unknown>|undefined{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
export async function bounded<T>(original:Promise<T>,label:string,maximumMs=15000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([original,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(label)),maximumMs);})]);}
 finally{clearTimeout(timer);}
}
export function exactError(error:unknown):string{
 assert(error instanceof Error);return `${error.name}: ${error.message}`.slice(0,256);
}
