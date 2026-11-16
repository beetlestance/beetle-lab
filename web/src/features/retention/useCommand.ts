import { useEffect,useRef,useState } from 'react';
import type { ApiClientResult } from '@beetle/contracts/api';
import { errorMessage,unknownOutcome,useApi } from '../../app/api.js';
interface Owner {active:boolean;busy:boolean;controller:AbortController;original:(()=>Promise<void>)|null}
/** One explicit original; scope retirement fences callbacks without implying rollback. */
export function useRetentionCommand(identity:string){
 const api=useApi();const owner=useRef<Owner>({active:true,busy:false,controller:new AbortController(),original:null});
 const [pending,setPending]=useState(false);const [unknown,setUnknown]=useState(false);const [message,setMessage]=useState<string|null>(null);
 useEffect(()=>{
  const current:Owner={active:true,busy:false,controller:new AbortController(),original:null};owner.current=current;
  setPending(false);setUnknown(false);setMessage(null);
  return()=>{current.active=false;current.controller.abort();};
 },[api,identity]);
 function start<T>(send:(signal:AbortSignal)=>Promise<ApiClientResult<T>>,accept:(value:T)=>void):void{
  const current=owner.current;if(!current.active||current.busy||current.original)return;
  current.original=async()=>{
   if(!current.active||current.busy)return;current.busy=true;current.controller=new AbortController();setPending(true);setMessage(null);
   let reply:ApiClientResult<T>;try{reply=await send(current.controller.signal);}catch{reply={ok:false,error:{kind:'transport'}};}
   if(!current.active)return;current.busy=false;setPending(false);
   if(!reply.ok){const uncertain=unknownOutcome(reply.error);setUnknown(uncertain);setMessage(uncertain?`${errorMessage(reply.error)} Outcome unknown. Refresh the batch or retry the identical request.`:errorMessage(reply.error));if(!uncertain)current.original=null;return;}
   current.original=null;setUnknown(false);accept(reply.value);
  };void current.original();
 }
 return{start,pending,unknown,message,blocked:pending||unknown,retry:()=>{void owner.current.original?.();}};
}
export type RetentionCommand=ReturnType<typeof useRetentionCommand>;
