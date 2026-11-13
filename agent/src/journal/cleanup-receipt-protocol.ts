import type { Scope } from '../admission/index.js';
import type { StoredCleanupReceipt } from '../cleanup-control/index.js';
export type CleanupReceiptOperation={readonly kind:'cleanupReceiptRead';readonly key:Scope;readonly planIdentity:string}
 |{readonly kind:'cleanupReceiptCommit';readonly key:Scope;readonly planIdentity:string;readonly json:string};
export type CleanupReceiptValue={readonly key:Scope;readonly planIdentity:string;readonly stored:StoredCleanupReceipt|null};
export function cleanupReceiptOperation(input:{readonly kind:string}):input is CleanupReceiptOperation{return input.kind==='cleanupReceiptRead'||input.kind==='cleanupReceiptCommit';}
