import { createHash } from 'node:crypto';
import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { cleanupControl } from './limits.js';
import { nativeCleanupPlanIdentity } from './plan.js';
import { captureCleanupProgress } from './progress.js';
import type { NativeCleanupPlan } from './plan.js';
import type { CleanupProgress } from './progress.js';
export interface NativeCleanupReceipt {
  readonly protocolVersion: 1; readonly purpose: 'performance'; readonly retirementVersion: 1;
  readonly retirementRequestDigest: string; readonly namespaceIdentity: string; readonly taskNamespaceIdentity: string;
  readonly planIdentity: string; readonly finalProgressVersion: number;
  readonly closure: 'owned-task-absent-after-original-close-v1';
}
/** The native owner must establish IO; this codec only checks its bounded, bound value. */
export function captureNativeCleanupReceipt(input: unknown, plan: NativeCleanupPlan, progress: CleanupProgress): NativeCleanupReceipt {
  const final = captureCleanupProgress(progress, plan);
  if (final.state !== 'files_absent') throw new Error('Incomplete native cleanup progress');
  const row = JSON.parse(encodeJson(input, cleanupControl.receiptBytes)) as NativeCleanupReceipt;
  const expected: NativeCleanupReceipt = { protocolVersion: 1, purpose: 'performance', retirementVersion: 1,
    retirementRequestDigest: plan.retirementRequestDigest, namespaceIdentity: plan.namespaceIdentity,
    taskNamespaceIdentity: plan.taskNamespaceIdentity, planIdentity: nativeCleanupPlanIdentity(plan),
    finalProgressVersion: final.version, closure: 'owned-task-absent-after-original-close-v1' };
  if (encodeCanonicalJson(row, cleanupControl.receiptBytes) !== encodeCanonicalJson(expected, cleanupControl.receiptBytes)) throw new Error('Invalid native cleanup receipt');
  return expected;
}
export function nativeCleanupReceiptIdentity(receipt: NativeCleanupReceipt): string {
  return createHash('sha256').update(encodeCanonicalJson(receipt, cleanupControl.receiptBytes)).digest('hex');
}
