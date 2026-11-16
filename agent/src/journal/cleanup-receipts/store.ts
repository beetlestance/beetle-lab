import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureNativeCleanupReceipt,captureStoredCleanupReceipt,nativeCleanupReceiptIdentity,cleanupControl,cleanupDigest } from '../../cleanup-control/index.js';
import type { NativeCleanupPlan,StoredCleanupReceipt } from '../../cleanup-control/index.js';
import { eligibleStoredPlan,checkedText } from '../cleanup-plans/index.js';
import { readCleanupProgress } from '../cleanup-progress/index.js';
import { sourceScope } from '../output-source-input.js';
import { Failure,transaction } from '../sql.js';
import type { CleanupReceiptOperation,CleanupReceiptValue } from '../cleanup-receipt-protocol.js';
import { cleanupReceiptOperation } from '../cleanup-receipt-protocol.js';
export function readCleanupReceipt(db:DatabaseSync,plan:NativeCleanupPlan):StoredCleanupReceipt|null{
 const row=db.prepare(`SELECT CASE WHEN length(CAST(receipt_json AS BLOB))<=${cleanupControl.receiptBytes} THEN receipt_json END AS json,receipt_identity,plan_identity,encoded_bytes,charged_bytes FROM output_cleanup_receipts WHERE attempt_id=?`).get(plan.original.attemptId);
 if(!row)return null;
 try{const json=checkedText(row.json,cleanupControl.receiptBytes);const result=captureStoredCleanupReceipt({receiptIdentity:row.receipt_identity,receipt:JSON.parse(json) as unknown},plan);
  if(row.plan_identity!==result.receipt.planIdentity||encodeCanonicalJson(result.receipt,cleanupControl.receiptBytes)!==json||row.encoded_bytes!==Buffer.byteLength(json)||row.charged_bytes!==Buffer.byteLength(json)+512)throw Error();return result;
 }catch{throw new Failure('unavailable');}
}
function commit(db:DatabaseSync,plan:NativeCleanupPlan,json:string):StoredCleanupReceipt{
 const progress=readCleanupProgress(db,plan);if(!progress||progress.state!=='files_absent')throw new Failure('conflict');
 let receipt:StoredCleanupReceipt['receipt'];try{receipt=captureNativeCleanupReceipt(JSON.parse(json) as unknown,plan,progress);}catch{throw new Failure('invalid_input');}
 const receiptIdentity=nativeCleanupReceiptIdentity(receipt);const existing=readCleanupReceipt(db,plan);if(existing){if(existing.receiptIdentity!==receiptIdentity)throw new Failure('conflict');return existing;}
 const canonical=encodeCanonicalJson(receipt,cleanupControl.receiptBytes);const bytes=Buffer.byteLength(canonical);
 db.prepare('INSERT INTO output_cleanup_receipts(attempt_id,plan_identity,receipt_identity,receipt_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?,?,?)')
  .run(plan.original.attemptId,receipt.planIdentity,receiptIdentity,canonical,bytes,bytes+512);return{receipt,receiptIdentity};
}
function capture(input:CleanupReceiptOperation&{id:number}):CleanupReceiptOperation{
 const copy=JSON.parse(encodeJson(input,cleanupControl.receiptBytes+2048)) as CleanupReceiptOperation&{id:number};
 if(!cleanupReceiptOperation(copy)||!Number.isSafeInteger(copy.id)||copy.id<=0||!cleanupDigest(copy.planIdentity))throw Error();
 const fields=copy.kind==='cleanupReceiptCommit'?'id,json,key,kind,planIdentity':'id,key,kind,planIdentity';if(Object.keys(copy).sort().join(',')!==fields)throw Error();
 const key=sourceScope(copy.key);return copy.kind==='cleanupReceiptRead'?{kind:copy.kind,key,planIdentity:copy.planIdentity}
  :{kind:copy.kind,key,planIdentity:copy.planIdentity,json:checkedText(copy.json,cleanupControl.receiptBytes)};
}
export class CleanupReceiptStore{
 constructor(private readonly db:DatabaseSync){}
 execute(input:CleanupReceiptOperation&{id:number}):CleanupReceiptValue{
  let command:CleanupReceiptOperation;try{command=capture(input);}catch{throw new Failure('invalid_input');}
  return transaction(this.db,()=>{const stored=eligibleStoredPlan(this.db,command.key,command.planIdentity);
   return{key:command.key,planIdentity:stored.planIdentity,stored:command.kind==='cleanupReceiptRead'?readCleanupReceipt(this.db,stored.plan):commit(this.db,stored.plan,command.json)};});
 }
}
