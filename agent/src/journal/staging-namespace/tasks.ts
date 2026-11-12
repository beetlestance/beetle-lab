import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { runtimeName } from '../../runtime-identity.js';
import { captureTaskNamespaceState, sealTaskNamespace, namespaceCaps } from '../../staging-namespace/index.js';
import type { InstalledRootFacts, TaskNamespaceIntent, TaskNamespaceState, TaskDirectoryFacts, TaskNamespaceAnchor, TaskNamespaceKey } from '../../staging-namespace/index.js';
import { Failure, owner } from '../sql.js';
import { assertCleanupControl } from './control.js';
import { readInstalledNamespace } from './installed.js';
export function readTaskNamespace(db: DatabaseSync, key: TaskNamespaceKey): TaskNamespaceState | null {
  owner(db, key);
  const row = db.prepare('SELECT state,intent_json,anchor_json FROM task_staging_namespaces WHERE attempt_id=?').get(key.attemptId);
  if (!row) return null;
  return captureTaskNamespaceState({ state: row.state, intent: JSON.parse(String(row.intent_json)) as unknown,
    ...(row.anchor_json === null ? {} : { anchor: JSON.parse(String(row.anchor_json)) as unknown }) });
}
export function beginTaskNamespace(db: DatabaseSync, intent: TaskNamespaceIntent): TaskNamespaceState {
  const original = owner(db, intent.original); assertCleanupControl(db, original);
  const installed = readInstalledNamespace(db);
  if (installed?.state !== 'bound' || intent.namespaceIdentity !== installed.anchor.namespaceIdentity) throw new Failure('recovery_required');
  if (intent.original.intentDigest !== original.intent_digest || intent.purpose !== original.execution_purpose
    || intent.runtimeName !== runtimeName({ ...intent.original, installationId: installed.intent.root.installationId })) throw new Failure('conflict');
  const existing = readTaskNamespace(db, intent.original);
  if (existing) {
    if (encodeCanonicalJson(existing.intent, namespaceCaps.task) !== encodeCanonicalJson(intent, namespaceCaps.task)) throw new Failure('conflict');
    return existing;
  }
  if (db.prepare('SELECT 1 FROM task_staging_namespaces WHERE namespace_identity=? AND runtime_name=?')
    .get(intent.namespaceIdentity, intent.runtimeName)) throw new Failure('conflict');
  db.prepare("INSERT INTO task_staging_namespaces(attempt_id,namespace_identity,runtime_name,state,intent_json) VALUES(?,?,?,'preparing',?)")
    .run(intent.original.attemptId, intent.namespaceIdentity, intent.runtimeName, encodeCanonicalJson(intent, namespaceCaps.task));
  return { state: 'preparing', intent };
}
export function commitTaskNamespace(db: DatabaseSync, input: { intent: TaskNamespaceIntent; directories: TaskDirectoryFacts }): TaskNamespaceAnchor {
  const state = readTaskNamespace(db, input.intent.original);
  if (!state || encodeCanonicalJson(state.intent, namespaceCaps.task) !== encodeCanonicalJson(input.intent, namespaceCaps.task)) throw new Failure('conflict');
  const original = owner(db, input.intent.original); assertCleanupControl(db, original);
  const installed = readInstalledNamespace(db);
  if (installed?.state !== 'bound') throw new Failure('recovery_required');
  matchTaskRoot(input.directories, installed.intent.root);
  const anchor = sealTaskNamespace(input);
  if (state.state === 'prepared') {
    if (state.anchor.taskNamespaceIdentity !== anchor.taskNamespaceIdentity) throw new Failure('conflict'); return state.anchor;
  }
  db.prepare("UPDATE task_staging_namespaces SET state='prepared',anchor_json=?,task_namespace_identity=? WHERE attempt_id=?")
    .run(encodeCanonicalJson(anchor, namespaceCaps.task), anchor.taskNamespaceIdentity, input.intent.original.attemptId);
  return anchor;
}

function matchTaskRoot(directories: TaskDirectoryFacts, installed: InstalledRootFacts): void {
  const root = installed.native;
  for (const native of Object.values(directories)) {
    if (native.dev !== root.dev || native.uid !== root.uid || native.gid !== root.gid || native.ino === root.ino) throw new Failure('conflict');
  }
}
