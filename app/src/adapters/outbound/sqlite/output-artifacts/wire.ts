import { encodeCanonicalJson } from '@beetle/contracts';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { OutputArtifactClaim, OutputArtifactProgress } from '../../../../ports/output-artifacts.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { Operation } from '../protocol.js';
import { boundedCopy } from '../input-values.js';
import { closed, natural } from '../output-custody/values.js';
import { decodeArtifact, digest, writer } from '../output-custody/slot.js';
export type ArtifactOperation = {kind: 'outputClaimArtifact'; request: OutputArtifactClaim}
  | {kind: 'outputBeginPublication'; request: OutputArtifactClaim}
  | {kind: 'outputRecordProgress'; request: OutputArtifactProgress}
  | {kind: 'outputRecordPublication'; request: OutputArtifactProgress};
const kinds = ['outputClaimArtifact', 'outputBeginPublication', 'outputRecordProgress', 'outputRecordPublication'];
export function artifactOperation(input: unknown): input is ArtifactOperation {
  if (!input || typeof input !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kinds.includes(kind.value as string);
}
export function captureArtifactOperation(input: Operation): ArtifactOperation {
  const copy = boundedCopy(input, 4096); requireRule(artifactOperation(copy));
  closed(copy, Object.hasOwn(copy, 'messageId') ? ['kind', 'request', 'messageId'] : ['kind', 'request']);
  if ('messageId' in copy) { natural(copy.messageId); requireRule(copy.messageId > 0); }
  const request = copy.request;
  closed(request, 'receipt' in request ? ['key', 'writerId', 'expectedVersion', 'receipt'] : ['key', 'writerId', 'expectedVersion']);
  const key = request.key; closed(key, ['binding', 'manifestDigest', 'sourceDigest', 'ordinal']);
  const binding = captureEventBinding(key.binding);
  requireRule(digest(key.manifestDigest) && digest(key.sourceDigest));
  natural(key.ordinal); requireRule(key.ordinal <= 127); writer(request.writerId);
  natural(request.expectedVersion); requireRule(request.expectedVersion > 0);
  if (copy.kind === 'outputRecordProgress' || copy.kind === 'outputRecordPublication') {
    const receipt = copy.request.receipt; closed(receipt, ['token', 'offset', 'phase', 'identity']);
    writer(receipt.token); natural(receipt.offset); requireRule(digest(receipt.identity));
    requireRule(receipt.phase === (copy.kind === 'outputRecordProgress' ? 'transferring' : 'published'));
  } else requireRule(!('receipt' in request));
  return {kind: copy.kind, request: {...request, key: {...key, binding}}} as ArtifactOperation;
}
export function captureArtifactReply(operation: ArtifactOperation, input: unknown): OutputFileRecord {
  const copy = boundedCopy(input, 4096) as OutputFileRecord; closed(copy, ['binding', 'artifact']);
  requireRule(encodeCanonicalJson(captureEventBinding(copy.binding), 4096) === encodeCanonicalJson(operation.request.key.binding, 4096));
  const artifact = decodeArtifact(copy.artifact); requireRule(artifact.ordinal === operation.request.key.ordinal);
  requireRule(artifact.version >= operation.request.expectedVersion);
  if (artifact.phase !== 'published') requireRule(artifact.writer === operation.request.writerId);
  if ('receipt' in operation.request) {
    const receipt = operation.request.receipt;
    requireRule(artifact.token === receipt.token && artifact.identity === receipt.identity && artifact.offset >= receipt.offset);
  }
  if (operation.kind === 'outputBeginPublication') requireRule(artifact.phase !== 'transferring');
  if (operation.kind === 'outputRecordPublication') requireRule(artifact.phase === 'published');
  return copy;
}
