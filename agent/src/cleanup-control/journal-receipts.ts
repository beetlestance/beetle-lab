import type { NativeCleanupPlan } from './plan.js';
import type { NativeCleanupReceipt } from './receipt.js';
export interface StoredCleanupReceipt { readonly receiptIdentity:string;readonly receipt:NativeCleanupReceipt }
/** Metadata only; the private native receipt owner supplies actual IO provenance. */
export interface JournalCleanupReceipts {
 read(plan:NativeCleanupPlan):Promise<StoredCleanupReceipt|null>;
 commit(plan:NativeCleanupPlan,receipt:NativeCleanupReceipt):Promise<StoredCleanupReceipt>;
 settleCarrier():Promise<void>;
}
