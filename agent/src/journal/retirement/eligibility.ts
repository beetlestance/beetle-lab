import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { encodeCanonicalJson } from '@beetle/contracts';
import { OUTPUT_ABSENCE_BYTES } from '@beetle/contracts/output-source';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { Scope } from '../../admission/index.js';
import { makeRetirementIntent, retirementTaskSnapshot, retirementDigest } from '../../retirement-values/index.js';
import type { TaskNamespaceState } from '../../staging-namespace/index.js';
import type { RetirementIntent } from '../../retirement-values/index.js';
import { readJournalAuthority } from '../authority.js';
import { readInstalledNamespace } from '../staging-namespace/installed.js';
import { readTaskNamespace } from '../staging-namespace/tasks.js';
import { assertCleanupControl } from '../staging-namespace/index.js';
import { readSourceState } from '../output-source-context.js';
import { readOutputDeliveryAtomic } from '../output-delivery.js';
import { readOutputAbsenceAtomic } from '../output-absence.js';
import { admissionSnapshot } from '../admission-snapshot.js';
import { Failure, owner } from '../sql.js';
import type { Row } from '../sql.js';
export function retirementKey(request: RetirementRequest): Scope & { generation: 1 } {
  return { organizationId: request.organizationId, workspaceId: request.workspaceId, attemptId: request.attemptId, generation: request.generation };
}
function requireFact(value: unknown, reason: 'conflict' | 'recovery_required' = 'conflict'): asserts value {
  if (!value) throw new Failure(reason);
}
type OutputRoot = { path: string; dev: string; ino: string; uid: string };
function sourceClosure(db: DatabaseSync, request: RetirementRequest, output: OutputRoot | null): void {
  const expected = request.closure; requireFact(expected.kind === 'source');
  const state = readSourceState(db, retirementKey(request)); const delivery = readOutputDeliveryAtomic(db, retirementKey(request));
  requireFact(state.source && delivery && state.reservation?.status === 'released');
  requireFact(output, 'recovery_required'); const root = state.source.root;
  requireFact(root.directory === output.path && root.device === output.dev && root.inode === output.ino
    && String(root.uid) === output.uid, 'recovery_required');
  requireFact(state.reservation.specDigest === state.source.manifest.binding.specDigest);
  requireFact(delivery.finalAgentSeq === expected.finalAgentSeq && delivery.receipt.sourceDigest === expected.sourceDigest
    && delivery.receipt.manifestDigest === expected.manifestDigest && delivery.receipt.journalAuthority === request.journalAuthority);
}
function closure(db: DatabaseSync, request: RetirementRequest, row: Row, output: { path: string; dev: string; ino: string; uid: string } | null): void {
  const key = retirementKey(request); const expected = request.closure;
  requireFact(row.last_seq === expected.finalAgentSeq && row.acknowledged_seq >= expected.finalAgentSeq);
  if (expected.kind === 'absence') {
    const proof = readOutputAbsenceAtomic(db, key);
    requireFact(proof && proof.finalAgentSeq === expected.finalAgentSeq);
    requireFact(retirementDigest(encodeCanonicalJson(proof, OUTPUT_ABSENCE_BYTES)) === expected.proofDigest); return;
  }
  sourceClosure(db, request, output);
}
function taskOutput(db: DatabaseSync, request: RetirementRequest, task: TaskNamespaceState | null,
  installed: Extract<NonNullable<ReturnType<typeof readInstalledNamespace>>, { state: 'bound' }>): OutputRoot | null {
  const key = retirementKey(request); let output: OutputRoot | null = null;
  if (task) requireFact(task.intent.namespaceIdentity === installed.anchor.namespaceIdentity
    && task.intent.original.intentDigest === request.intentDigest && task.intent.purpose === 'performance', 'recovery_required');
  if (task?.state === 'prepared') {
    const state = readSourceState(db, key);
    if (state.reservation?.specDigest != null) requireFact(state.reservation?.specDigest === task.intent.specDigest, 'recovery_required');
    const native = task.anchor.directories.output;
    output = { path: join(installed.intent.root.target, task.intent.runtimeName, 'output'), dev: native.dev, ino: native.ino, uid: native.uid };
  }
  return output;
}
/** One validator serves read-only preflight and the atomic write; never trusts earlier preflight. */
export function eligibleRetirement(db: DatabaseSync, request: RetirementRequest): RetirementIntent {
  const key = retirementKey(request); const row = owner(db, key);
  requireFact(row.intent_digest === request.intentDigest && row.execution_purpose === 'performance');
  requireFact(readJournalAuthority(db) === request.journalAuthority); assertCleanupControl(db, row);
  requireFact(admissionSnapshot(db, row)?.state === 'released', 'recovery_required');
  const installed = readInstalledNamespace(db); requireFact(installed?.state === 'bound', 'recovery_required');
  const task = readTaskNamespace(db, key); const output = taskOutput(db, request, task, installed);
  closure(db, request, row, output);
  return makeRetirementIntent({ request, namespaceIdentity: installed.anchor.namespaceIdentity, task: retirementTaskSnapshot(task) });
}
