import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { cleanupDigest } from '../cleanup-control/index.js';
import { captureTaskDirectories } from './task.js';
import { namespaceCaps } from './types.js';
import type { TaskDirectoryFacts, TaskNamespaceAnchor, TaskReconciliation } from './types.js';
const roles = ['task', 'input', 'output', 'secrets'] as const;
function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid task reconciliation');
}
/**
 * Newly observed directory facts for a prepared task whose recorded facts went stale when the
 * installed root was renumbered (decision 030). The anchor and its identity never change; the
 * reconciliation is bound to that identity and to the retirement whose runtime absence was proven.
 * Owner, group and mode must equal the recorded ones. Device and inode numbers are per-start
 * observations, so any values are accepted, including the anchor's own: folders that move A→B→A
 * replace a recorded B with A, and the record is never cleared (decision 030).
 */
export function captureTaskReconciliation(input: unknown, anchor: TaskNamespaceAnchor): TaskReconciliation {
  const value = JSON.parse(encodeJson(input, namespaceCaps.task)) as unknown;
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  const fields = ['protocolVersion', 'taskNamespaceIdentity', 'retirementRequestDigest', 'directories'];
  assert(Object.keys(row).length === fields.length && fields.every((field) => Object.hasOwn(row, field)));
  assert(row.protocolVersion === 1 && row.taskNamespaceIdentity === anchor.taskNamespaceIdentity);
  assert(cleanupDigest(row.retirementRequestDigest));
  const directories = captureTaskDirectories(row.directories);
  for (const role of roles) {
    const recorded = anchor.directories[role];
    const observed = directories[role];
    assert(observed.uid === recorded.uid && observed.gid === recorded.gid && observed.mode === recorded.mode);
  }
  const result: TaskReconciliation = {
    protocolVersion: 1,
    taskNamespaceIdentity: anchor.taskNamespaceIdentity,
    retirementRequestDigest: row.retirementRequestDigest as string,
    directories,
  };
  assert(encodeCanonicalJson(row, namespaceCaps.task) === encodeCanonicalJson(result, namespaceCaps.task));
  return result;
}
/** The directory facts cleanup checks against: the reconciled ones when present, else the anchor's. */
export function effectiveTaskDirectories(
  anchor: TaskNamespaceAnchor,
  reconciliation: TaskReconciliation | null,
): TaskDirectoryFacts {
  if (!reconciliation) return anchor.directories;
  assert(reconciliation.taskNamespaceIdentity === anchor.taskNamespaceIdentity);
  return reconciliation.directories;
}
