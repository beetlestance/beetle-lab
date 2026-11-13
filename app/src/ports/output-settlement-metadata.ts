import type { SettlementReply } from '@beetle/contracts/output-settlement';
import type { OutputDeletionKey } from './output-deletion-metadata.js';
export interface BackendSettlementWrite {readonly key:OutputDeletionKey;readonly agentReply:SettlementReply|null}
export interface BackendSettlementResult {
 readonly version:1;readonly key:OutputDeletionKey;readonly attemptId:string;readonly kind:'source'|'absence'|'unsent';
 readonly refundedBytes:number;readonly chargedBytes:2560;readonly tombstoneDigest:string;
}
export type BackendSettlementOperation={readonly kind:'settleBackendOutput';readonly request:BackendSettlementWrite}
 |{readonly kind:'readBackendSettlement';readonly key:OutputDeletionKey};
export type BackendSettlementState={readonly kind:'missing'}|{readonly kind:'settled';readonly settlement:BackendSettlementResult};
export type BackendSettlementValue=BackendSettlementResult|BackendSettlementState;
/** Private runner reconciliation only. Neither public request bodies nor missing rows authorise credit. */
export interface OutputSettlementMetadata {
 settle(request:BackendSettlementWrite):Promise<BackendSettlementResult>;
 read(key:OutputDeletionKey):Promise<BackendSettlementState>;
}
