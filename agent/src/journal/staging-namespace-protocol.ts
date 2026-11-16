import type { InstalledNamespaceAnchor, InstalledNamespaceState, NamespaceIntent, TaskNamespaceAnchor, TaskNamespaceState, TaskNamespaceKey } from '../staging-namespace/index.js';
export type NamespaceOperation = { readonly kind: 'namespaceRead' }
  | { readonly kind: 'namespaceBegin' | 'namespaceCommit' | 'taskNamespaceBegin' | 'taskNamespaceCommit'; readonly json: string }
  | { readonly kind: 'taskNamespaceRead'; readonly key: TaskNamespaceKey };
export type NamespaceValue = NamespaceIntent | InstalledNamespaceAnchor | InstalledNamespaceState | TaskNamespaceAnchor | TaskNamespaceState;
export function namespaceOperation(input: { kind: string }): input is NamespaceOperation {
  return ['namespaceRead', 'namespaceBegin', 'namespaceCommit', 'taskNamespaceBegin', 'taskNamespaceCommit', 'taskNamespaceRead'].includes(input.kind);
}
