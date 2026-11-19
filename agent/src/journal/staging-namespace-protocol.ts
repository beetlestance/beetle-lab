import type {
  InstalledNamespaceAnchor,
  InstalledNamespaceState,
  NamespaceIntent,
  TaskNamespaceAnchor,
  TaskNamespaceState,
  TaskNamespaceKey,
  TaskReconciliation,
} from '../staging-namespace/index.js';
export type NamespaceOperation =
  | { readonly kind: 'namespaceRead' }
  | {
      readonly kind: 'namespaceBegin' | 'namespaceCommit' | 'taskNamespaceBegin' | 'taskNamespaceCommit';
      readonly json: string;
    }
  | { readonly kind: 'taskNamespaceRead' | 'taskReconciliationRead'; readonly key: TaskNamespaceKey }
  | { readonly kind: 'taskReconciliationCommit'; readonly key: TaskNamespaceKey; readonly json: string };
export type NamespaceValue =
  | NamespaceIntent
  | InstalledNamespaceAnchor
  | InstalledNamespaceState
  | TaskNamespaceAnchor
  | TaskNamespaceState
  | TaskReconciliation;
export function namespaceOperation(input: { kind: string }): input is NamespaceOperation {
  return [
    'namespaceRead',
    'namespaceBegin',
    'namespaceCommit',
    'taskNamespaceBegin',
    'taskNamespaceCommit',
    'taskNamespaceRead',
    'taskReconciliationRead',
    'taskReconciliationCommit',
  ].includes(input.kind);
}
