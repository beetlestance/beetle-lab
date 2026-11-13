import type { RetentionPreviewRequest,RetentionApplyRequest,RetentionApplyReceipt,WorkspaceScope } from '@beetle/contracts/api';
import type { RetentionSnapshot } from '../domain/retention/index.js';
export type WorkspaceRetentionPreviewRequest=Omit<RetentionPreviewRequest,'scope'>&{readonly scope:WorkspaceScope};
export interface WorkspaceRetentionPreviewCommand {readonly id:string;readonly capturedAt:string;readonly request:WorkspaceRetentionPreviewRequest}
/** One bounded immutable page. This interface does not claim parent-scope traversal. */
export interface WorkspaceRetentionStore {preview(command:WorkspaceRetentionPreviewCommand):Promise<RetentionSnapshot>}

export type WorkspaceRetentionApplyRequest=Omit<RetentionApplyRequest,'scope'>&{readonly scope:WorkspaceScope};
export interface WorkspaceRetentionApplyCommand {readonly id:string;readonly appliedAt:string;readonly request:WorkspaceRetentionApplyRequest}

export interface RetentionStatusKey {readonly scope:WorkspaceScope;readonly id:string}
export interface RetentionStatusItem {
 readonly runId:string;readonly runVersion:number;readonly deletionId:string;
 readonly phase:'preview'|'admitted'|'backend_files'|'agent_cleanup'|'settling'|'settled'|'blocked';
 readonly fileCount:number|null;readonly preparedCount:number|null;readonly absentCount:number|null;
 readonly error:null|'unavailable'|'conflict'|'capacity_unavailable'|'cleanup_failed';readonly refundedLogicalBytes:number;
}
export interface RetentionStatus {
 readonly id:string;readonly scope:WorkspaceScope;readonly kind:'retention'|'manual';readonly estimatedLogicalBytes:number;readonly state:'preview'|'applied'|'completed';
 readonly capturedAt:string;readonly expiresAt:string;readonly completedAt:string|null;
 readonly items:readonly RetentionStatusItem[];readonly completedCount:number;readonly refundedLogicalBytes:number;
}

export interface RetentionDiscardReceipt {readonly id:string;readonly scope:WorkspaceScope;readonly refundedLogicalBytes:131072}
export interface RetentionMetadata extends WorkspaceRetentionStore {
 apply(command:WorkspaceRetentionApplyCommand):Promise<RetentionApplyReceipt>;
 get(key:RetentionStatusKey,now:number):Promise<RetentionStatus>;
 discard(key:RetentionStatusKey,now:number):Promise<RetentionDiscardReceipt>;
}
export type RetentionOperation=
 | {readonly kind:'previewWorkspaceRetention';readonly command:WorkspaceRetentionPreviewCommand}
 | {readonly kind:'applyWorkspaceRetention';readonly command:WorkspaceRetentionApplyCommand}
 | {readonly kind:'getWorkspaceRetentionStatus'|'discardWorkspaceRetention';readonly request:{readonly key:RetentionStatusKey;readonly now:number}};
export type RetentionValue=RetentionSnapshot|RetentionApplyReceipt|RetentionStatus|RetentionDiscardReceipt;
