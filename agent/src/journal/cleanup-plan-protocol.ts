import type { Scope } from '../admission/index.js';
import type { StoredCleanupPlan } from '../cleanup-control/index.js';
export type CleanupPlanOperation = { readonly kind: 'cleanupPlanStore'; readonly json: string }
  | { readonly kind: 'cleanupPlanRead'; readonly key: Scope };
export type CleanupPlanValue = { readonly key: Scope; readonly stored: StoredCleanupPlan | null };
export function cleanupPlanOperation(input: { readonly kind: string }): input is CleanupPlanOperation {
  return input.kind === 'cleanupPlanStore' || input.kind === 'cleanupPlanRead';
}
