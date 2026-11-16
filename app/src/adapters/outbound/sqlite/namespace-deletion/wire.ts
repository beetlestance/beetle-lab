import { encodeCanonicalJson } from '@beetle/contracts';
import { prepareNamespaceDeletion, captureNamespaceDeletionReply } from '../../../../application/namespace-deletion/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { NamespaceDeletionOperation } from '../../../../ports/namespace-deletion.js';
import { sha256 } from '../input-values.js';
export type { NamespaceDeletionOperation } from '../../../../ports/namespace-deletion.js';
export function captureNamespaceDeletionOperation(input: NamespaceDeletionOperation): NamespaceDeletionOperation {
  const value = JSON.parse(encodeCanonicalJson(input, 4096)) as NamespaceDeletionOperation;
  requireRule(Object.keys(value).every(key => ['kind','command','messageId'].includes(key)) && value.kind === 'deleteNamespace');
  const {intentDigest, ...intent} = value.command;
  requireRule(Object.keys(intent).length === 3 && prepareNamespaceDeletion(intent, sha256).intentDigest === intentDigest);
  return {kind: 'deleteNamespace', command: {...intent, intentDigest}};
}
export { captureNamespaceDeletionReply };
