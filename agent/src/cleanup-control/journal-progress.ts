import type { NativeCleanupPlan } from './plan.js';
import type { CleanupProgress } from './progress.js';
/** Metadata transitions only; native effects require the separate trusted owner. */
export interface JournalCleanupProgress {
 read(plan:NativeCleanupPlan):Promise<CleanupProgress|null>;
 begin(plan:NativeCleanupPlan):Promise<CleanupProgress>;
 advance(plan:NativeCleanupPlan,next:CleanupProgress):Promise<CleanupProgress>;
 settleCarrier():Promise<void>;
}
