import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import {
  captureTaskNamespaceIntent,
  captureTaskReconciliation,
  candidatePageSize,
  namespaceCaps,
} from '../../staging-namespace/index.js';
import type {
  ReconciliationCandidatePage,
  TaskNamespaceAnchor,
  TaskNamespaceKey,
  TaskReconciliation,
} from '../../staging-namespace/index.js';
import { Failure, owner } from '../sql.js';
import { readInstalledNamespace } from './installed.js';
import { readTaskNamespace } from './tasks.js';
export function readTaskReconciliation(db: DatabaseSync, key: TaskNamespaceKey): TaskReconciliation | null {
  const task = readTaskNamespace(db, key);
  if (task?.state !== 'prepared') return null;
  const row = db
    .prepare('SELECT reconciliation_json FROM task_staging_namespaces WHERE attempt_id=?')
    .get(key.attemptId);
  if (row?.reconciliation_json === null || row?.reconciliation_json === undefined) return null;
  return captureTaskReconciliation(JSON.parse(String(row.reconciliation_json)) as unknown, task.anchor);
}

/**
 * Records reconciled directory facts (decision 030). The agent proves runtime absence and observes
 * the folders before calling this; here the Journal checks the durable side: the task is prepared,
 * the retirement intent named by the reconciliation exists for the same task identity, no cleanup
 * plan, progress or receipt exists yet, and owner, group and mode equal the recorded facts.
 */
export function reconcileTaskNamespace(
  db: DatabaseSync,
  key: TaskNamespaceKey,
  input: TaskReconciliation,
): TaskReconciliation {
  owner(db, key);
  const anchor = reconcilableAnchor(db, key);
  let reconciliation: TaskReconciliation;
  try {
    reconciliation = captureTaskReconciliation(input, anchor);
  } catch {
    throw new Failure('conflict');
  }
  // Table checks keep these columns equal to the stored intent's requestDigest and task identity.
  const retirement = db
    .prepare('SELECT request_digest,task_namespace_identity FROM output_retirement_intents WHERE attempt_id=?')
    .get(key.attemptId);
  if (
    retirement?.request_digest !== reconciliation.retirementRequestDigest ||
    retirement.task_namespace_identity !== anchor.taskNamespaceIdentity
  )
    throw new Failure('conflict');
  for (const table of ['output_cleanup_plans', 'output_cleanup_progress', 'output_cleanup_receipts'])
    if (db.prepare(`SELECT 1 FROM ${table} WHERE attempt_id=?`).get(key.attemptId)) throw new Failure('conflict');
  const json = encodeCanonicalJson(reconciliation, namespaceCaps.task);
  const existing = readTaskReconciliation(db, key);
  if (existing && encodeCanonicalJson(existing, namespaceCaps.task) === json) return existing;
  db.prepare('UPDATE task_staging_namespaces SET reconciliation_json=? WHERE attempt_id=?').run(json, key.attemptId);
  return reconciliation;
}
function reconcilableAnchor(db: DatabaseSync, key: TaskNamespaceKey): TaskNamespaceAnchor {
  const installed = readInstalledNamespace(db);
  if (installed?.state !== 'bound') throw new Failure('recovery_required');
  const task = readTaskNamespace(db, key);
  if (task?.state !== 'prepared' || task.intent.namespaceIdentity !== installed.anchor.namespaceIdentity)
    throw new Failure('conflict');
  for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const)
    if (task.intent.original[field] !== key[field]) throw new Failure('conflict');
  return task.anchor;
}

/**
 * Read-only listing for the operator command: prepared tasks in the bound namespace whose stored
 * retirement intent names the same task identity, with no cleanup plan, progress, receipt or
 * settled replay. One bounded page per call, ordered by attempt ID.
 */
export function reconciliationCandidates(db: DatabaseSync, after: string | null): ReconciliationCandidatePage {
  const rows = db
    .prepare(
      `SELECT t.intent_json,t.reconciliation_json IS NOT NULL AS reconciled FROM task_staging_namespaces t
       JOIN output_retirement_intents r ON r.attempt_id=t.attempt_id
       JOIN installed_staging_namespace n ON n.namespace_identity=t.namespace_identity
       WHERE n.state='bound' AND t.state='prepared' AND r.namespace_identity=t.namespace_identity
       AND r.task_namespace_identity=t.task_namespace_identity AND t.attempt_id>?
       AND NOT EXISTS(SELECT 1 FROM output_cleanup_plans WHERE attempt_id=t.attempt_id)
       AND NOT EXISTS(SELECT 1 FROM output_cleanup_progress WHERE attempt_id=t.attempt_id)
       AND NOT EXISTS(SELECT 1 FROM output_cleanup_receipts WHERE attempt_id=t.attempt_id)
       AND NOT EXISTS(SELECT 1 FROM retired_attempts WHERE attempt_id=t.attempt_id)
       ORDER BY t.attempt_id LIMIT ?`,
    )
    .all(after ?? '', candidatePageSize + 1);
  const candidates = rows.slice(0, candidatePageSize).map((row) => {
    const original = captureTaskNamespaceIntent(JSON.parse(String(row.intent_json)) as unknown).original;
    const { organizationId, workspaceId, attemptId, generation } = original;
    return { key: { organizationId, workspaceId, attemptId, generation }, reconciled: row.reconciled === 1 };
  });
  const last = candidates.at(-1);
  return { candidates, next: rows.length > candidatePageSize && last ? last.key.attemptId : null };
}
