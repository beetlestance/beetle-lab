import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureNativeCleanupPlan, nativeCleanupPlanIdentity, cleanupControl } from '../../cleanup-control/index.js';
import type { NativeCleanupPlan } from '../../cleanup-control/index.js';
import { captureRetirementIntent } from '../../retirement-values/index.js';
import type { RetirementIntent } from '../../retirement-values/index.js';
import { captureTaskNamespaceAnchor, captureTaskNamespaceIntent, namespaceCaps } from '../../staging-namespace/index.js';
import type { TaskNamespaceAnchor } from '../../staging-namespace/index.js';
export function checkedText(value: unknown, cap: number): string {
  if (typeof value !== 'string' || value.length > cap || Buffer.byteLength(value) > cap) throw new Error('Invalid cleanup metadata'); return value;
}
export function matchesPlan(plan: NativeCleanupPlan, intent: RetirementIntent, task: TaskNamespaceAnchor): boolean {
  const request = intent.request; const original = { organizationId: request.organizationId, workspaceId: request.workspaceId,
    attemptId: request.attemptId, generation: request.generation, intentDigest: request.intentDigest };
  if (intent.task.state !== 'prepared' || plan.retirementRequestDigest !== intent.requestDigest
    || plan.namespaceIdentity !== intent.namespaceIdentity || plan.taskNamespaceIdentity !== intent.task.taskNamespaceIdentity
    || plan.taskNamespaceIdentity !== task.taskNamespaceIdentity || task.intent.purpose !== 'performance'
    || task.intent.namespaceIdentity !== plan.namespaceIdentity) return false;
  if (encodeCanonicalJson(plan.original, 512) !== encodeCanonicalJson(original, 512)
    || encodeCanonicalJson(task.intent.original, 512) !== encodeCanonicalJson(original, 512)) return false;
  return (['task', 'input', 'output', 'secrets'] as const).every(role => {
    const row = plan.entries.find(entry => entry.path === (role === 'task' ? '' : role));
    return row?.kind === 'directory' && encodeCanonicalJson(row.native, 512) === encodeCanonicalJson(task.directories[role], 512);
  });
}
export function registerCleanupPlanValidation(db: DatabaseSync): void {
  db.function('cleanup_plan_identity', { deterministic: true }, input => {
    try {
      const raw = checkedText(input, cleanupControl.planBytes); const plan = captureNativeCleanupPlan(JSON.parse(raw) as unknown);
      if (raw !== encodeCanonicalJson(plan, cleanupControl.planBytes)) return null; return nativeCleanupPlanIdentity(plan);
    } catch { return null; }
  });
  db.function('cleanup_plan_matches', { deterministic: true }, (input, retirement, taskIntent, taskAnchor) => {
    try {
      const plan = captureNativeCleanupPlan(JSON.parse(checkedText(input, cleanupControl.planBytes)) as unknown);
      const intent = captureRetirementIntent(JSON.parse(checkedText(retirement, cleanupControl.intentBytes)) as unknown);
      const task = captureTaskNamespaceIntent(JSON.parse(checkedText(taskIntent, namespaceCaps.task)) as unknown);
      const anchor = captureTaskNamespaceAnchor(JSON.parse(checkedText(taskAnchor, namespaceCaps.task)) as unknown, task);
      return matchesPlan(plan, intent, anchor) ? 1 : 0;
    } catch { return 0; }
  });
}
