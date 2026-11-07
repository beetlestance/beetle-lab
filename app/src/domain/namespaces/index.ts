export { SemanticError, requireRule, sameScope, sameUuid, nextVersion, normalizedName, foldedName,
  validatedSlug, immutableSnapshot } from './primitives.js';
export { MAX_FOLDER_DEPTH, checkedParentChain, validateFolderPlacement } from './folders.js';
export type { FolderEvidence } from './folders.js';
export { decideNamespaceChange } from './transition.js';
export type { NamespaceOperation, NamespaceCommand, NamespaceEntity, NamespaceEvidence, NamespaceChange } from './types.js';
