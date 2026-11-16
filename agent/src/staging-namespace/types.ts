import type { CleanupOriginal, NativeDirectoryFact, NativeFileFact } from '../cleanup-control/index.js';
export interface InstalledRootFacts {
  readonly protocolVersion: 1; readonly installationId: string; readonly daemonId: string;
  readonly source: string; readonly target: string; readonly native: NativeDirectoryFact;
}
export interface NamespaceIntent {
  readonly protocolVersion: 1; readonly namespaceId: string; readonly journalAuthority: string;
  readonly root: InstalledRootFacts; readonly rootDigest: string; readonly nonce: string;
}
export interface NamespaceMarker extends NativeFileFact { readonly sha256: string }
export interface InstalledNamespaceAnchor {
  readonly protocolVersion: 1; readonly namespaceId: string; readonly rootDigest: string;
  readonly marker: NamespaceMarker; readonly namespaceIdentity: string;
}
export type InstalledNamespaceState = { readonly state: 'preparing'; readonly intent: NamespaceIntent }
  | { readonly state: 'bound'; readonly intent: NamespaceIntent; readonly anchor: InstalledNamespaceAnchor };
export interface TaskNamespaceIntent {
  readonly protocolVersion: 1; readonly original: CleanupOriginal; readonly purpose: 'performance' | 'standalone_export';
  readonly namespaceIdentity: string; readonly specDigest: string; readonly runtimeName: string;
}
export interface TaskDirectoryFacts {
  readonly task: NativeDirectoryFact; readonly input: NativeDirectoryFact;
  readonly output: NativeDirectoryFact; readonly secrets: NativeDirectoryFact;
}
export interface TaskNamespaceAnchor {
  readonly protocolVersion: 1; readonly intent: TaskNamespaceIntent; readonly directories: TaskDirectoryFacts;
  readonly taskNamespaceIdentity: string;
}
export type TaskNamespaceState = { readonly state: 'preparing'; readonly intent: TaskNamespaceIntent }
  | { readonly state: 'prepared'; readonly intent: TaskNamespaceIntent; readonly anchor: TaskNamespaceAnchor };
export interface TaskNamespaceKey { readonly attemptId: string; readonly organizationId: string; readonly workspaceId: string; readonly generation: 1 }
export interface StagingNamespaceJournal {
  begin(root: InstalledRootFacts): Promise<NamespaceIntent>;
  commit(input: { readonly intent: NamespaceIntent; readonly marker: NamespaceMarker }): Promise<InstalledNamespaceAnchor>;
  read(): Promise<InstalledNamespaceState | null>;
  beginTask(input: TaskNamespaceIntent): Promise<TaskNamespaceState>;
  commitTask(input: { readonly intent: TaskNamespaceIntent; readonly directories: TaskDirectoryFacts }): Promise<TaskNamespaceAnchor>;
  readTask(key: TaskNamespaceKey): Promise<TaskNamespaceState | null>;
}
/** Frozen protocol1 sizes; do not revise applied-schema limits in place. */
export const namespaceCaps = Object.freeze({ root: 8192, intent: 12_288, anchor: 16_384, state: 32_768,
  singleton: 32_768, marker: 1024, task: 8192, taskRowAllowance: 512, markerName: '.beetle-namespace-v1.json' });
