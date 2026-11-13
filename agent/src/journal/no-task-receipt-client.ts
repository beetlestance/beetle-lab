import { encodeJson } from '@beetle/contracts';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { makeNoTaskReceipt,captureStoredNoTaskReceipt } from '../no-task-receipt-values/index.js';
import type { NoTaskReceiptBinding,StoredNoTaskReceipt } from '../no-task-receipt-values/index.js';
import { claimNoTaskObservation } from '../no-task-receipt/protocol.js';
import type { NoTaskObservation } from '../no-task-receipt/protocol.js';
import type { NoTaskReceiptOperation } from './no-task-receipt-protocol.js';
export interface JournalNoTaskReceipts {
 read(binding:NoTaskReceiptBinding):Promise<StoredNoTaskReceipt|null>;
 commit(observation:NoTaskObservation):Promise<StoredNoTaskReceipt>;
}
interface Options {send(operation:()=>NoTaskReceiptOperation):Promise<unknown>;invalidReply():never;settleCarrier():Promise<void>;owner():object}
export function createNoTaskReceiptClient(options:Options):JournalNoTaskReceipts{
 return Object.freeze({
  async read(input:NoTaskReceiptBinding){
   makeNoTaskReceipt(input);const expected=JSON.parse(encodeJson(input,4096)) as NoTaskReceiptBinding;
   const value=await options.send(()=>({kind:'noTaskReceiptRead',json:encodeJson({request:captureOutputRetirementRequest(expected.request)},6144)}));
   try{return value===null?null:captureStoredNoTaskReceipt(value,expected);}catch{return options.invalidReply();}
  },
  async commit(observation:NoTaskObservation){
   let claimed:ReturnType<typeof claimNoTaskObservation>|undefined;let known=false;
   try{
    const value=await options.send(()=>{
     claimed=claimNoTaskObservation(observation,options.owner());
     return{kind:'noTaskReceiptCommit',json:encodeJson({request:captureOutputRetirementRequest(claimed.binding.request),receipt:claimed.receipt},6144)};
    });
    if(!claimed)return options.invalidReply();let result:StoredNoTaskReceipt;
    try{result=captureStoredNoTaskReceipt(value,claimed.binding);}catch{return options.invalidReply();}
    known=true;return result;
   }catch(error){await options.settleCarrier();known=true;throw error;}
   finally{if(known)claimed?.release();}
  },
 });
}
