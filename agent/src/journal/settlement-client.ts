import { encodeJson } from '@beetle/contracts';
import { captureOutputRetirementRequest,captureOutputRetirementReply } from '@beetle/contracts/output-retirement';
import type { RetirementReply } from '@beetle/contracts/output-retirement';
import { captureSettlementRequest,captureSettlementReply } from '@beetle/contracts/output-settlement';
import type { SettlementReply } from '@beetle/contracts/output-settlement';
import { ownSettlementCarrier } from '../cleanup-access/index.js';
import type { SettlementObservation } from '../cleanup-access/index.js';
import { retirementDigest } from '../retirement-values/index.js';
import type { SettlementOperation } from './settlement-protocol.js';
export interface JournalSettlements{
 settle(observation:SettlementObservation,request:unknown):Promise<SettlementReply>;
 retiredReply(request:unknown):Promise<RetirementReply|null>;
 settleCarrier():Promise<void>;
}
interface Options{
 send(operation:()=>SettlementOperation):Promise<unknown>;
 invalidReply():never;
 settleCarrier():Promise<void>;
 owner():object;
}
export function createSettlementClient(options:Options):JournalSettlements{
 return Object.freeze({
  async settle(observation:SettlementObservation,input:unknown){
   const request=captureSettlementRequest(input);const carrier=ownSettlementCarrier(observation,options.owner(),request.retirement);
   let known=false;
   try{
    const value=await options.send(()=>({kind:'settleAgentStorage',json:encodeJson(request,3584)}));let result:SettlementReply;
    try{result=captureSettlementReply(value,request,retirementDigest);}catch{return options.invalidReply();}
    known=true;return result;
   }catch(error){await options.settleCarrier();known=true;throw error;}
   finally{if(known)carrier.release();}
  },
  async retiredReply(input:unknown){
   const expected=captureOutputRetirementRequest(input);
   const value=await options.send(()=>({kind:'readRetiredOutputReply',json:encodeJson(expected,3072)}));
   try{
    const row=JSON.parse(encodeJson(value,4608)) as {reply:unknown};
    if(!row||typeof row!=='object'||Object.keys(row).join(',')!=='reply')throw Error();
    if(row.reply===null)return null;return captureOutputRetirementReply(row.reply,expected,retirementDigest);
   }catch{return options.invalidReply();}
  },
  settleCarrier:()=>options.settleCarrier(),
 });
}
