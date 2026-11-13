import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { RetentionStatusKey } from '../../../../ports/retention.js';
import { accounting,requireFact } from '../retention-accounting/facts.js';
import { snapshotById } from '../retention-selection/rows.js';
import { observeAppliedPage } from './observe.js';
function canonicalTime(value:unknown):string{
 requireFact(typeof value==='string'&&value.length===24,'unavailable');const parsed=Date.parse(value);
 requireFact(Number.isFinite(parsed)&&new Date(parsed).toISOString()===value,'unavailable');return value;
}
/** Positive permanent per-member evidence only. No phase text authorises completion. */
export function prepareRetentionCompletion(db:DatabaseSync,runs:{get(key:RunKey):Run},key:RetentionStatusKey,now:number){
 requireFact(db.isTransaction&&Number.isSafeInteger(now)&&now>=0&&now<=253402300799999);
 const stored=snapshotById(db,key.scope,key.id);const snapshot=stored.snapshot;
 if(stored.state==='preview')return{ready:false as const,snapshot,state:'preview' as const,completedAt:null,observation:null};
 requireFact(typeof stored.applyBody==='string','unavailable');const observation=observeAppliedPage(db,runs,snapshot,stored.applyBody);
 if(stored.state==='completed'){
  requireFact(observation.complete,'unavailable');return{ready:false as const,snapshot,state:'completed' as const,completedAt:canonicalTime(stored.completedAt),observation};
 }
 requireFact(stored.state==='applied'&&stored.completedAt===null,'unavailable');
 if(!observation.complete)return{ready:false as const,snapshot,state:'applied' as const,completedAt:null,observation};
 const clock=Math.max(now,accounting(db).clock_ms);const completedAt=new Date(clock).toISOString();
 return{ready:true as const,snapshot,state:'completed' as const,completedAt,observation,body:stored.body,applyBody:stored.applyBody};
}
