import type { RetentionPolicy,SettingsScope,WorkspaceScope } from '@beetle/contracts/api';
import type { RetentionPrefix,RetentionReason } from './rule-types.js';
export const RETENTION_SNAPSHOT_BYTES=131072;
export const RETENTION_SNAPSHOT_BODY_BYTES=32768;
export const RETENTION_PROGRESS_BODY_BYTES=256;
export const RETENTION_SNAPSHOT_LIMIT=8;
export const RETENTION_SNAPSHOT_LIFETIME_MS=900000;
export interface RetentionSettingsPin {readonly id:string;readonly version:number}
export interface RetentionMember {
 readonly id:string;readonly version:number;readonly estimatedBytes:number;readonly reason:RetentionReason|'manual';
 readonly deletionId:string;readonly requestId:string;
}
export type ParentRetentionScope=Exclude<SettingsScope,WorkspaceScope>;
export interface RetentionTraversalContext {
 readonly scope:ParentRetentionScope;readonly horizon:WorkspaceScope;readonly nextWorkspace:WorkspaceScope|null;readonly previousSnapshotId:string|null;
}
export interface RetentionSnapshot {
 readonly traversal?:RetentionTraversalContext;
 readonly version:1;readonly id:string;readonly kind:'retention'|'manual';readonly scope:WorkspaceScope;
 readonly requestId:string;readonly intentDigest:string;readonly capturedAt:string;readonly expiresAt:string;
 readonly settings:{readonly installation:RetentionSettingsPin;readonly organization:RetentionSettingsPin;readonly workspace:RetentionSettingsPin};
 readonly policy:RetentionPolicy;readonly policySource:SettingsScope;readonly epoch:number;
 readonly predecessorId:string|null;readonly before:RetentionPrefix;readonly after:RetentionPrefix;
 readonly scanned:number;readonly cursor:{readonly requestedAt:string;readonly id:string}|null;readonly hasMore:boolean;
 readonly candidates:readonly RetentionMember[];
 readonly exclusions:readonly {readonly reason:'active'|'pinned'|'unknown'|'cleanup_in_progress';readonly count:number;readonly estimatedBytes:number|null}[];
}
export interface RetentionItemProgress {
 readonly phase:'admitted'|'backend_files'|'agent_cleanup'|'settled'|'blocked';
 readonly preparedCount:number;readonly absentCount:number;readonly fileCount:number;
 readonly error:null|'unavailable'|'conflict'|'capacity_unavailable'|'cleanup_failed';
}
