import type { Scope } from '../admission/index.js';
import type { CleanupProgress } from '../cleanup-control/index.js';
export type CleanupProgressOperation={readonly kind:'cleanupProgressRead';readonly key:Scope;readonly planIdentity:string}
 |{readonly kind:'cleanupProgressBegin';readonly key:Scope;readonly planIdentity:string}
 |{readonly kind:'cleanupProgressAdvance';readonly key:Scope;readonly planIdentity:string;readonly json:string};
export type CleanupProgressValue={readonly key:Scope;readonly planIdentity:string;readonly progress:CleanupProgress|null};
export function cleanupProgressOperation(input:{readonly kind:string}):input is CleanupProgressOperation{
 return ['cleanupProgressRead','cleanupProgressBegin','cleanupProgressAdvance'].includes(input.kind);
}
