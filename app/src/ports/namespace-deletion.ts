import type { DeleteOrganizationRequest, DeleteWorkspaceRequest, DeleteFolderRequest, DeletionReceipt } from '@beetle/contracts/api';
export type NamespaceDeletionIntent =
  | { kind: 'organization'; id: string; request: DeleteOrganizationRequest }
  | { kind: 'workspace'; id: string; request: DeleteWorkspaceRequest }
  | { kind: 'folder'; id: string; request: DeleteFolderRequest };
export type NamespaceDeletionCommand = NamespaceDeletionIntent & { intentDigest: string };
/** Empty-only, receipt-first atomic metadata deletion; permanent paid marker; no native IO/refund. */
export interface NamespaceDeletionStore { delete(command: NamespaceDeletionCommand): Promise<DeletionReceipt> }

export type NamespaceDeletionOperation = {kind: 'deleteNamespace'; command: NamespaceDeletionCommand};
