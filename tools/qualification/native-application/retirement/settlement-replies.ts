import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureSettlementRequest,captureSettlementReply } from '@beetle/contracts/output-settlement';
import type { SettlementRequest,SettlementReply } from '@beetle/contracts/output-settlement';
export interface SettlementObservation {readonly request:SettlementRequest;readonly reply:SettlementReply;readonly digest:string}
/** One bounded observed reply, captured only after the actual upstream committed response. */
export class SettlementReplies {
 private paused=false;private blocked=0;
 private calls=0;private replies=0;private value:SettlementObservation|undefined;private resolve!:(value:SettlementObservation)=>void;
 readonly first=new Promise<SettlementObservation>(resolve=>{this.resolve=resolve;});
 release():void{this.paused=false;}
 block():boolean{if(!this.paused)return false;this.blocked++;return true;}
 called():void{this.calls++;}
 capture(body:Buffer,value:Buffer):boolean{
  const raw:unknown=JSON.parse(value.toString('utf8'));
  if(!raw||typeof raw!=='object'||Reflect.get(raw,'state')!=='settled')return false;
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const request=captureSettlementRequest(JSON.parse(body.toString('utf8')) as unknown);const reply=captureSettlementReply(raw,request,hash);
  const digest=hash(encodeCanonicalJson(reply,512));this.replies++;
  if(this.value){assert.equal(digest,this.value.digest);return false;}
  this.paused=true;this.value={request,reply,digest};this.resolve(this.value);return true;
 }
 state(){return{calls:this.calls,replies:this.replies,dropped:!!this.value,blocked:this.blocked,paused:this.paused,digest:this.value?.digest??null};}
}
