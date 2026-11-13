import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureCleanupProgress,captureNativeCleanupPlan,cleanupProgressFollows,cleanupControl } from '../../cleanup-control/index.js';
import { checkedText } from '../cleanup-plans/index.js';
export function registerCleanupProgressValidation(db:DatabaseSync):void{
 db.function('cleanup_progress_initial',{deterministic:true},(input,planJson)=>{
  try{const raw=checkedText(input,cleanupControl.progressBytes);const plan=captureNativeCleanupPlan(JSON.parse(checkedText(planJson,cleanupControl.planBytes)) as unknown);
   const progress=captureCleanupProgress(JSON.parse(raw) as unknown,plan);
   return raw===encodeCanonicalJson(progress,cleanupControl.progressBytes)&&progress.state==='prepared'?1:0;
  }catch{return 0;}
 });
 db.function('cleanup_progress_next',{deterministic:true},(prior,next,planJson)=>{
  try{const raw=checkedText(next,cleanupControl.progressBytes);const plan=captureNativeCleanupPlan(JSON.parse(checkedText(planJson,cleanupControl.planBytes)) as unknown);
   const old=captureCleanupProgress(JSON.parse(checkedText(prior,cleanupControl.progressBytes)) as unknown,plan);const progress=captureCleanupProgress(JSON.parse(raw) as unknown,plan);
   return raw===encodeCanonicalJson(progress,cleanupControl.progressBytes)&&cleanupProgressFollows(old,progress)?1:0;
  }catch{return 0;}
 });
}
