export interface RetentionPrefix {readonly completedCount:number;readonly logicalBytes:number|null}
export interface RetentionFact {
 readonly requestedAt:string;readonly completed:boolean;
 readonly logicalBytes:number|null;
 readonly protection:'none'|'pinned'|'unknown'|'cleanup_in_progress';
}
export type RetentionReason='age'|'completed_count'|'storage_budget';
export interface RetentionDecision {
 readonly reason:RetentionReason|null;
 readonly excluded:Exclude<RetentionFact['protection'],'none'>|'active'|null;
}
