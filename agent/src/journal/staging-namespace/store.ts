import type { DatabaseSync } from 'node:sqlite';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import {
  captureInstalledRoot,
  captureNamespaceIntent,
  captureNamespaceMarker,
  captureTaskNamespaceIntent,
  captureTaskNamespaceKey,
  captureTaskDirectories,
  namespaceCaps,
} from '../../staging-namespace/index.js';
import { Failure, transaction } from '../sql.js';
import type { NamespaceOperation, NamespaceValue } from '../staging-namespace-protocol.js';
import type {
  InstalledRootFacts,
  NamespaceIntent,
  NamespaceMarker,
  TaskNamespaceIntent,
  TaskDirectoryFacts,
  TaskNamespaceKey,
} from '../../staging-namespace/index.js';
import { readInstalledNamespace, beginInstalledNamespace, commitInstalledNamespace } from './installed.js';
import { readTaskNamespace, beginTaskNamespace, commitTaskNamespace } from './tasks.js';
import { readTaskReconciliation, reconcileTaskNamespace, reconciliationCandidates } from './reconciliation.js';
type Checked =
  | { kind: 'namespaceRead' }
  | { kind: 'namespaceBegin'; root: InstalledRootFacts }
  | { kind: 'namespaceCommit'; request: { intent: NamespaceIntent; marker: NamespaceMarker } }
  | { kind: 'taskNamespaceRead'; key: TaskNamespaceKey }
  | { kind: 'taskNamespaceBegin'; intent: TaskNamespaceIntent }
  | { kind: 'taskNamespaceCommit'; request: { intent: TaskNamespaceIntent; directories: TaskDirectoryFacts } }
  | { kind: 'taskReconciliationRead'; key: TaskNamespaceKey }
  | { kind: 'taskReconciliationCommit'; key: TaskNamespaceKey; reconciliation: unknown }
  | { kind: 'taskReconciliationCandidates'; after: string | null };
function captureUuid(value: unknown): string {
  if (!validatePrimitive('uuid', value).ok) throw new Error('Invalid candidate cursor');
  return value as string;
}
function parse(json: string): Record<string, unknown> {
  if (typeof json !== 'string' || json.length > namespaceCaps.state || Buffer.byteLength(json) > namespaceCaps.state)
    throw new Error('Invalid namespace JSON');
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid namespace object');
  return value as Record<string, unknown>;
}
function pair(row: Record<string, unknown>, second: string): void {
  if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'intent') || !Object.hasOwn(row, second))
    throw new Error('Invalid namespace pair');
}
function capture(operation: NamespaceOperation & { id: number }): Checked {
  const cap = namespaceCaps.state * 2;
  const copy = JSON.parse(encodeJson(operation, cap)) as NamespaceOperation & { id: number };
  const payload: readonly string[] =
    copy.kind === 'namespaceRead'
      ? []
      : copy.kind === 'taskNamespaceRead' || copy.kind === 'taskReconciliationRead'
        ? ['key']
        : copy.kind === 'taskReconciliationCommit'
          ? ['key', 'json']
          : copy.kind === 'taskReconciliationCandidates'
            ? ['after']
            : ['json'];
  const fields = Object.keys(copy);
  if (
    fields.length !== payload.length + 2 ||
    !fields.every((field) => field === 'kind' || field === 'id' || payload.includes(field))
  )
    throw new Error('Invalid namespace command');
  if (!Number.isSafeInteger(copy.id) || copy.id < 1) throw new Error('Invalid namespace command ID');
  return capturePayload(copy);
}
function capturePayload(operation: NamespaceOperation): Checked {
  if (operation.kind === 'namespaceRead') return { kind: operation.kind };
  if (operation.kind === 'taskReconciliationCandidates')
    return { kind: operation.kind, after: operation.after === null ? null : captureUuid(operation.after) };
  if (!('json' in operation)) return { kind: operation.kind, key: captureTaskNamespaceKey(operation.key) };
  if (operation.kind === 'taskReconciliationCommit')
    // The reconciliation is captured against the stored anchor inside the transaction.
    return { kind: operation.kind, key: captureTaskNamespaceKey(operation.key), reconciliation: parse(operation.json) };
  const row = parse(operation.json);
  switch (operation.kind) {
    case 'namespaceBegin':
      return { kind: operation.kind, root: captureInstalledRoot(row) };
    case 'namespaceCommit': {
      pair(row, 'marker');
      const intent = captureNamespaceIntent(row.intent);
      return { kind: operation.kind, request: { intent, marker: captureNamespaceMarker(row.marker, intent) } };
    }
    case 'taskNamespaceBegin':
      return { kind: operation.kind, intent: captureTaskNamespaceIntent(row) };
    case 'taskNamespaceCommit': {
      pair(row, 'directories');
      return {
        kind: operation.kind,
        request: {
          intent: captureTaskNamespaceIntent(row.intent),
          directories: captureTaskDirectories(row.directories),
        },
      };
    }
  }
}
export class NamespaceStore {
  constructor(private readonly db: DatabaseSync) {}
  execute(operation: NamespaceOperation & { id: number }): NamespaceValue | null {
    let checked: Checked;
    try {
      checked = capture(operation);
    } catch {
      throw new Failure('invalid_input');
    }
    // Storage/corruption errors retain their actual failure; only capture errors are invalid input.
    return transaction(this.db, () => this.dispatch(checked));
  }
  private dispatch(operation: Checked): NamespaceValue | null {
    switch (operation.kind) {
      case 'namespaceRead':
        return readInstalledNamespace(this.db);
      case 'namespaceBegin':
        return beginInstalledNamespace(this.db, operation.root);
      case 'namespaceCommit':
        return commitInstalledNamespace(this.db, operation.request);
      case 'taskNamespaceRead':
        return readTaskNamespace(this.db, operation.key);
      case 'taskNamespaceBegin':
        return beginTaskNamespace(this.db, operation.intent);
      case 'taskNamespaceCommit':
        return commitTaskNamespace(this.db, operation.request);
      case 'taskReconciliationRead':
        return readTaskReconciliation(this.db, operation.key);
      case 'taskReconciliationCandidates':
        return reconciliationCandidates(this.db, operation.after);
      case 'taskReconciliationCommit':
        return reconcileTaskNamespace(
          this.db,
          operation.key,
          operation.reconciliation as Parameters<typeof reconcileTaskNamespace>[2],
        );
    }
  }
}
