import { encodeJson } from '@beetle/contracts';
import { captureCleanupProgress } from './progress.js';
import { captureNativeCleanupReceipt,nativeCleanupReceiptIdentity } from './receipt.js';
import type { NativeCleanupPlan } from './plan.js';
import type { StoredCleanupReceipt } from './journal-receipts.js';
import { nativeCleanupPlanIdentity } from './plan.js';
import { cleanupControl } from './limits.js';
/** Expected value shape only; this is not observed progress or native proof. */
export function finalCleanupProgress(plan:NativeCleanupPlan){return captureCleanupProgress({protocolVersion:1,planIdentity:nativeCleanupPlanIdentity(plan),entryCount:plan.entries.length,
 removedCount:plan.entries.length,version:plan.entries.length+2,state:'files_absent'},plan);}
export function captureStoredCleanupReceipt(input:unknown,plan:NativeCleanupPlan):StoredCleanupReceipt{
 const raw=JSON.parse(encodeJson(input,cleanupControl.receiptBytes+256)) as unknown;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid cleanup receipt');const row=raw as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='receipt,receiptIdentity')throw Error('Invalid cleanup receipt');
 const receipt=captureNativeCleanupReceipt(row.receipt,plan,finalCleanupProgress(plan));const receiptIdentity=nativeCleanupReceiptIdentity(receipt);
 if(row.receiptIdentity!==receiptIdentity)throw Error('Invalid cleanup receipt identity');return{receipt,receiptIdentity};
}
