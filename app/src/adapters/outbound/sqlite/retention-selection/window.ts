import { randomUUID } from 'node:crypto';
import { evaluateRetentionWindow,captureRetentionSnapshot,RETENTION_SNAPSHOT_LIFETIME_MS } from '../../../../domain/retention/index.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { StorageError } from '../protocol.js';
import { requireFact } from '../retention-accounting/facts.js';
import { previewHeaders } from './rows.js';
import { inspectRetentionFact } from './facts.js';
import type { retentionBasis } from '../retention-accounting/index.js';
import type { capturePreviewCommand } from './values.js';
type Basis=ReturnType<typeof retentionBasis>;
type Command=ReturnType<typeof capturePreviewCommand>;
function exclusions(decisions:ReturnType<typeof evaluateRetentionWindow>['decisions'],bytes:readonly (number|null)[]):RetentionSnapshot['exclusions']{
 const counts=new Map<NonNullable<typeof decisions[number]['excluded']>,{count:number;estimatedBytes:number|null}>();
 decisions.forEach((decision,index)=>{
  if(decision.excluded===null)return;const prior=counts.get(decision.excluded)??{count:0,estimatedBytes:0};const amount=bytes[index];requireFact(amount!==undefined);
  const total=prior.estimatedBytes===null||amount===null?null:prior.estimatedBytes+amount;
  requireFact(total===null||Number.isSafeInteger(total));counts.set(decision.excluded,{count:prior.count+1,estimatedBytes:total});
 });return[...counts].map(([reason,value])=>({reason,...value}));
}
/** At most100 evaluated originals plus one header-only existence probe. */
export function selectWindow(db:DatabaseSync,runs:{get(key:RunKey):Run},command:Command,basis:Basis,previous:RetentionSnapshot|null){
 try{
 const request=command.request;const initial={completedCount:0,logicalBytes:0};const before=previous?.after??initial;
 const headers=basis.policy.mode==='manual'?[]:previewHeaders(db,request.scope,request.page.limit,previous?.cursor??null);
 const selected=headers.slice(0,request.page.limit);const facts=selected.map(header=>inspectRetentionFact(db,runs,request.scope,header,request.requestId));
 const evaluated=evaluateRetentionWindow({policy:basis.policy,prefix:before,facts,now:Date.parse(command.capturedAt)});
 const candidates:RetentionSnapshot['candidates'][number][]=[];
 evaluated.decisions.forEach((decision,index)=>{
  if(decision.reason===null)return;const header=selected[index];const fact=facts[index];requireFact(header&&fact&&fact.logicalBytes!==null);
  candidates.push({id:header.id,version:header.version,estimatedBytes:fact.logicalBytes,reason:decision.reason,deletionId:randomUUID(),requestId:randomUUID()});
 });
 const last=selected.at(-1);const proposed={version:1,id:command.id,kind:'retention',scope:request.scope,requestId:request.requestId,intentDigest:command.intentDigest,
  capturedAt:command.capturedAt,expiresAt:new Date(Date.parse(command.capturedAt)+RETENTION_SNAPSHOT_LIFETIME_MS).toISOString(),settings:basis.settings,policy:basis.policy,policySource:basis.policySource,
  epoch:basis.epoch,predecessorId:previous?.id??null,before,after:evaluated.prefix,scanned:selected.length,cursor:last?{id:last.id,requestedAt:last.requested_at}:null,
  hasMore:headers.length>selected.length,candidates,exclusions:exclusions(evaluated.decisions,facts.map(fact=>fact.logicalBytes))};
 return captureRetentionSnapshot(proposed);
 }catch{throw new StorageError('unavailable');}
}
