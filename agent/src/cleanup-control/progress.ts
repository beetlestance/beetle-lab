import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { cleanupControl } from './limits.js';
import { nativeCleanupPlanIdentity } from './plan.js';
import type { NativeCleanupPlan } from './plan.js';
export interface CleanupProgress {
  readonly protocolVersion: 1; readonly planIdentity: string; readonly entryCount: number;
  readonly removedCount: number; readonly version: number; readonly state: 'prepared' | 'cleaning' | 'files_absent';
}
/** One mutable progress row; reverse plan order, each removal includes parent sync/close. */
export function captureCleanupProgress(input: unknown, plan: NativeCleanupPlan): CleanupProgress {
  const row = JSON.parse(encodeJson(input, cleanupControl.progressBytes)) as CleanupProgress;
  if (!row || Object.keys(row).sort().join(',') !== 'entryCount,planIdentity,protocolVersion,removedCount,state,version') throw new Error('Invalid cleanup progress');
  if (row.protocolVersion !== 1 || row.planIdentity !== nativeCleanupPlanIdentity(plan) || row.entryCount !== plan.entries.length) throw new Error('Invalid cleanup progress binding');
  if (!Number.isSafeInteger(row.removedCount) || row.removedCount < 0 || row.removedCount > row.entryCount) throw new Error('Invalid cleanup progress count');
  if (!progressState(row)) throw new Error('Invalid cleanup progress state');
  return row;
}
function progressState(row: CleanupProgress): boolean {
  if (row.state === 'prepared') return row.version === 1 && row.removedCount === 0;
  if (row.version !== row.removedCount + 2) return false;
  if (row.state === 'cleaning') return row.removedCount < row.entryCount;
  return row.state === 'files_absent' && row.removedCount === row.entryCount;
}
export function cleanupProgressFollows(prior: CleanupProgress, next: CleanupProgress): boolean {
  if (prior.planIdentity !== next.planIdentity || prior.entryCount !== next.entryCount) return false;
  if (encodeCanonicalJson(prior, cleanupControl.progressBytes) === encodeCanonicalJson(next, cleanupControl.progressBytes)) return true;
  if (next.version !== prior.version + 1) return false;
  if (prior.state === 'prepared') return next.state === 'cleaning' && next.removedCount === 0;
  return prior.state === 'cleaning' && (next.state === 'cleaning' || next.state === 'files_absent')
    && next.removedCount === prior.removedCount + 1;
}
