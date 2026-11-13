import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureNativeCleanupPlan,captureCleanupProgress,captureNativeCleanupReceipt,nativeCleanupReceiptIdentity,cleanupControl } from '../../cleanup-control/index.js';
import { checkedText } from '../cleanup-plans/index.js';
export function registerCleanupReceiptValidation(db:DatabaseSync):void{
 db.function('cleanup_receipt_identity',{deterministic:true},(input,planJson,progressJson)=>{
  try{const raw=checkedText(input,cleanupControl.receiptBytes);const plan=captureNativeCleanupPlan(JSON.parse(checkedText(planJson,cleanupControl.planBytes)) as unknown);
   const progress=captureCleanupProgress(JSON.parse(checkedText(progressJson,cleanupControl.progressBytes)) as unknown,plan);
   const receipt=captureNativeCleanupReceipt(JSON.parse(raw) as unknown,plan,progress);
   return raw===encodeCanonicalJson(receipt,cleanupControl.receiptBytes)?nativeCleanupReceiptIdentity(receipt):null;
  }catch{return null;}
 });
}
