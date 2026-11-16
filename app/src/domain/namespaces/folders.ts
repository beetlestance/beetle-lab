import type { Folder, Workspace, WorkspaceScope } from '@beetle/contracts/api';
import { requireRule, sameScope, sameUuid } from './primitives.js';

export const MAX_FOLDER_DEPTH = 8;

/** Root-to-target inclusive chain. Root depth is one; height counts edges. */
export interface FolderEvidence {
  workspace: Workspace;
  parentChain: readonly Folder[];
  /** Exact maximum descendant edge distance, computed with a bounded depth query. */
  subtreeHeight: number;
}

export function checkedParentChain(scope: WorkspaceScope, evidence: FolderEvidence): readonly Folder[] {
  const { workspace, parentChain } = evidence;
  requireRule(sameUuid(workspace.id, scope.workspaceId) &&
    sameUuid(workspace.scope.organizationId, scope.organizationId), 'not_found');
  requireRule(parentChain.length >= 1 && parentChain.length <= MAX_FOLDER_DEPTH);
  const seen = new Set<string>();
  parentChain.forEach((folder, index) => {
    requireRule(sameScope(folder.scope, scope), 'not_found');
    requireRule(!seen.has(folder.id.toLowerCase()));
    seen.add(folder.id.toLowerCase());
    const expectedParent = index === 0 ? null : parentChain[index - 1]?.id;
    requireRule(expectedParent == null ? folder.parentFolderId === null :
      folder.parentFolderId !== null && sameUuid(folder.parentFolderId, expectedParent));
  });
  requireRule(sameUuid(parentChain[0]!.id, workspace.rootFolderId));
  return parentChain;
}

export function validateFolderPlacement(input: {
  scope: WorkspaceScope; parentFolderId: string; moving?: Folder; evidence: FolderEvidence;
}): string[] {
  const { scope, parentFolderId, moving, evidence } = input;
  const chain = checkedParentChain(scope, evidence);
  requireRule(sameUuid(chain.at(-1)!.id, parentFolderId), 'not_found');
  if (moving) {
    requireRule(sameScope(moving.scope, scope), 'not_found');
    requireRule(!sameUuid(moving.id, evidence.workspace.rootFolderId) && moving.parentFolderId !== null);
    requireRule(!chain.some(folder => sameUuid(folder.id, moving.id)));
  }
  requireRule(Number.isSafeInteger(evidence.subtreeHeight) && evidence.subtreeHeight >= 0);
  requireRule(chain.length + 1 + evidence.subtreeHeight <= MAX_FOLDER_DEPTH);
  return chain.map(folder => folder.name);
}
