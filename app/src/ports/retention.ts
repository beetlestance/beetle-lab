import type { RetentionPreviewRequest,RetentionApplyRequest,WorkspaceScope } from '@beetle/contracts/api';
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
 readonly id:string;readonly scope:WorkspaceScope;readonly state:'preview'|'applied'|'completed';
 readonly capturedAt:string;readonly expiresAt:string;readonly completedAt:string|null;
 readonly items:readonly RetentionStatusItem[];readonly completedCount:number;readonly refundedLogicalBytes:number;
}
