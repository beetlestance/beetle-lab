import { retirementKey } from '../retirement/eligibility.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { RetirementIntent } from '../../retirement-values/index.js';
import { rejectedControlFacts } from './facts.js';
import { rejectedCounters,requireRejectedCapacity } from './capacity.js';
import { readRetirementIntent } from '../retirement/read.js';
import { Failure } from '../sql.js';
type Facts=ReturnType<typeof rejectedControlFacts>;
interface Funding {readonly facts:Facts;readonly json:string;readonly intentJson:string;readonly before:readonly[number,number,number];readonly clock:number;phase:'control'|'intent'}
const funding=new WeakMap<DatabaseSync,Funding>();
export function rejectedFundingActive(db:DatabaseSync):boolean{return funding.has(db);}
export function registerRejectedFunding(db:DatabaseSync):void{
 db.function('rejected_control_insert_allowed',(attempt,json)=>{
  const frame=funding.get(db);return frame?.phase==='control'&&attempt===frame.facts.request.attemptId&&json===frame.json?1:0;
 });
 db.function('rejected_intent_insert_allowed',(attempt,json)=>{
  const frame=funding.get(db);return frame?.phase==='intent'&&attempt===frame.facts.request.attemptId&&json===frame.intentJson?1:0;
 });
 db.function('rejected_funding_clock',()=>funding.get(db)?.clock??null);
 db.function('rejected_control_stats_allowed',(before,after)=>{
  const frame=funding.get(db);return frame?.phase==='control'&&before===JSON.stringify(frame.before)
   &&after===JSON.stringify([frame.before[0]+1,frame.before[1]+16384,frame.clock])&&frame.clock>=frame.before[2]?1:0;
 });
}
function sameIntent(left:RetirementIntent,right:RetirementIntent):boolean{return encodeCanonicalJson(left,4096)===encodeCanonicalJson(right,4096);}
/** Revalidate the positive immutable closure even for replay, without requiring fresh free capacity. */
export function rejectedCandidate(db:DatabaseSync,input:unknown):Facts{
 const facts=rejectedControlFacts(db,input);const prior=readRetirementIntent(db,retirementKey(facts.request));
 const row=db.prepare(`SELECT CASE WHEN length(CAST(control_json AS BLOB))<=1024 THEN control_json END json
  FROM rejected_cleanup_controls WHERE attempt_id=?`).get(facts.request.attemptId);
 if(prior||row){if(!prior||!row||!sameIntent(prior,facts.intent)||row.json!==encodeCanonicalJson(facts.control,1024))throw new Failure('conflict');}
 return facts;
}
/** Fixed synchronous body only; caller owns the immediate transaction. No permit escapes. */
export function fundRejectedIntent(db:DatabaseSync,input:unknown):RetirementIntent{
 if(!db.isTransaction||db.prepare('SELECT agent_settlement_active() active').get()?.active!==0)throw new Failure('conflict');const facts=rejectedCandidate(db,input);
 if(readRetirementIntent(db,retirementKey(facts.request)))return facts.intent;
 const clock=requireRejectedCapacity(db,facts);const before=rejectedCounters(db);
 const frame:Funding={facts,before,clock,json:encodeCanonicalJson(facts.control,1024),intentJson:encodeCanonicalJson(facts.intent,4096),phase:'control'};
 funding.set(db,frame);
 try{
  const changed=db.prepare(`INSERT INTO rejected_cleanup_controls(attempt_id,request_digest,namespace_identity,control_json,charged_bytes)
   VALUES(?,?,?,?,16384)`).run(facts.request.attemptId,facts.control.requestDigest,facts.control.namespaceIdentity,frame.json).changes;
  if(changed!==1)throw new Failure('conflict');frame.phase='intent';
  const written=db.prepare(`INSERT INTO output_retirement_intents(attempt_id,request_digest,namespace_identity,task_namespace_identity,intent_json)
   VALUES(?,?,?,NULL,?)`).run(facts.request.attemptId,facts.intent.requestDigest,facts.intent.namespaceIdentity,frame.intentJson).changes;
  const after=rejectedCounters(db);
  if(written!==1||after[0]!==before[0]+1||after[1]!==before[1]+16384||after[2]!==clock)throw new Failure('unavailable');
  return facts.intent;
 }finally{funding.delete(db);}
}
