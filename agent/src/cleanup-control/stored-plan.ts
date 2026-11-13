import { encodeJson } from '@beetle/contracts';
import { captureNativeCleanupPlan, nativeCleanupPlanIdentity } from './plan.js';
import type { NativeCleanupPlan, CleanupOriginal } from './plan.js';
import { cleanupControl } from './limits.js';
export type CleanupPlanKey = Omit<CleanupOriginal, 'intentDigest' | 'generation'> & { readonly generation: number };
export interface StoredCleanupPlan { readonly planIdentity: string; readonly plan: NativeCleanupPlan }
/** Metadata only; neither a native observation nor deletion authority. */
export interface JournalCleanupPlans {
  store(plan: NativeCleanupPlan): Promise<StoredCleanupPlan>;
  read(key: CleanupPlanKey): Promise<StoredCleanupPlan | null>;
  settleCarrier(): Promise<void>;
}
export const cleanupPlanFrameBytes = cleanupControl.planBytes * 2 + 4096;
export function captureStoredCleanupPlan(input: unknown): StoredCleanupPlan {
  const raw = JSON.parse(encodeJson(input, cleanupControl.planBytes + 256)) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid stored plan');
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'plan,planIdentity') throw new Error('Invalid stored plan');
  const plan = captureNativeCleanupPlan(row.plan); const planIdentity = nativeCleanupPlanIdentity(plan);
  if (row.planIdentity !== planIdentity) throw new Error('Invalid stored plan identity'); return { planIdentity, plan };
}
