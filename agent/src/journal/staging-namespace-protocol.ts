import type {
  InstalledNamespaceAnchor,
  InstalledNamespaceState,
  NamespaceIntent,
  TaskNamespaceAnchor,
  TaskNamespaceState,
  TaskNamespaceKey,
  TaskReconciliation,
  ReconciliationCandidatePage,
} from '../staging-namespace/index.js';
export type NamespaceOperation =
  | { readonly kind: 'namespaceRead' }
  | {
      readonly kind: 'namespaceBegin' | 'namespaceCommit' | 'taskNamespaceBegin' | 'taskNamespaceCommit';
      readonly json: string;
    }
  | { readonly kind: 'taskNamespaceRead' | 'taskReconciliationRead'; readonly key: TaskNamespaceKey }
  | { readonly kind: 'taskReconciliationCommit'; readonly key: TaskNamespaceKey; readonly json: string }
  | { readonly kind: 'taskReconciliationCandidates'; readonly after: string | null };
export type NamespaceValue =
  | NamespaceIntent
  | InstalledNamespaceAnchor
  | InstalledNamespaceState
  | TaskNamespaceAnchor
  | TaskNamespaceState
  | TaskReconciliation
  | ReconciliationCandidatePage;
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
    'taskReconciliationCandidates',
  ].includes(input.kind);
}
