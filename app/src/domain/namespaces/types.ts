import type {
  CreateFolderRequest, CreateOrganizationRequest, CreateWorkspaceRequest, Folder, Organization,
  PatchFolderRequest, PatchOrganizationRequest, PatchWorkspaceRequest, Workspace,
} from '@beetle/contracts/api';
import type { FolderEvidence } from './folders.js';

export type NamespaceOperation =
  | { kind: 'createOrganization'; id: string; request: CreateOrganizationRequest }
  | { kind: 'patchOrganization'; id: string; request: PatchOrganizationRequest }
  | { kind: 'createWorkspace'; id: string; rootFolderId: string; request: CreateWorkspaceRequest }
  | { kind: 'patchWorkspace'; id: string; request: PatchWorkspaceRequest }
  | { kind: 'createFolder'; id: string; request: CreateFolderRequest }
  | { kind: 'patchFolder'; id: string; request: PatchFolderRequest };

/** CREATE id/rootFolderId are fresh server allocations, not client intent fields.
 * The full command retains them for a new write; matching receipts retain original IDs.
 */
export type NamespaceCommand = NamespaceOperation & { intentDigest: string };
export type NamespaceEntity = Organization | Workspace | Folder;
export interface NamespaceEvidence {
  current?: NamespaceEntity;
  organization?: Organization;
  folder?: FolderEvidence;
}
export interface NamespaceChange {
  entity: NamespaceEntity;
  /** Created with its workspace in the same transaction. */
  rootFolder?: Folder;
  foldedName: string;
}
