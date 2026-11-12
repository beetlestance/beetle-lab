import {captureOutputState} from '../output-state.js';
import { artifactOperation, captureArtifactOperation, captureArtifactReply } from '../output-artifacts/index.js';
import type { ArtifactOperation } from '../output-artifacts/index.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import { verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import { captureEventBinding, captureEventKey } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { OutputCustodyState, OutputPage } from '../../../../ports/output-custody.js';
import type { Operation } from '../protocol.js';
import { boundedCopy, sha256 } from '../input-values.js';
import { closed, natural, scanQuery } from './values.js';
export type OutputOperation = ArtifactOperation | BaseOperation;
type BaseOperation = Exclude<Extract<Operation, {kind: 'outputScan' | 'outputLoad' | 'outputReadSource' | 'outputAdopt'}>, {kind: 'outputAdopt'}>
  | {kind: 'outputAdopt'; request: {binding: ReturnType<typeof captureEventBinding>; envelope: Owned<SourceEnvelope>}};
export type OutputValue = OutputCustodyState | OutputPage | Owned<SourceEnvelope> | OutputFileRecord | null;
const kinds = ['outputScan', 'outputLoad', 'outputReadSource', 'outputAdopt'];
export function outputOperation(input: unknown): input is OutputOperation {
  if (artifactOperation(input)) return true;
  if (!input || typeof input !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kinds.includes(kind.value as string);
}
export function outputReplyLimit(input: OutputOperation): number { return artifactOperation(input) ? 4096 : input.kind === 'outputReadSource' ? 75776 : 65536; }
export function captureOutputOperation(input: Operation): OutputOperation {
  if (artifactOperation(input)) return captureArtifactOperation(input);
  return captureBaseOperation(input);
}
function captureBaseOperation(input: Operation): BaseOperation {
  const copy = boundedCopy(input, 79872);
  requireRule(outputOperation(copy) && !artifactOperation(copy));
  const field = copy.kind === 'outputScan' ? 'query' : copy.kind === 'outputAdopt' ? 'request' : 'binding';
  closed(copy, Object.hasOwn(copy, 'messageId') ? ['kind', field, 'messageId'] : ['kind', field]);
  if ('messageId' in copy) { natural(copy.messageId); requireRule(copy.messageId > 0); }
  switch (copy.kind) {
    case 'outputScan': scanQuery(copy.query); return {kind: copy.kind, query: copy.query};
    case 'outputAdopt': {
      closed(copy.request, ['binding', 'envelope']);
      return {kind: copy.kind, request: {binding: captureEventBinding(copy.request.binding), envelope: verifySourceEnvelope(copy.request.envelope, sha256)}};
    }
    case 'outputLoad': case 'outputReadSource': return {kind: copy.kind, binding: captureEventBinding(copy.binding)};
  }
}
export function captureOutputReply(operation: OutputOperation, input: unknown): OutputValue {
  if (artifactOperation(operation)) return captureArtifactReply(operation, input);
  return captureBaseReply(operation, input);
}
function captureBaseReply(operation: BaseOperation, input: unknown): OutputValue {
  const copy = boundedCopy(input, outputReplyLimit(operation));
  if (operation.kind === 'outputReadSource') {
    if (copy === null) return null;
    const source = verifySourceEnvelope(copy, sha256);
    const b = source.manifest.binding; const a = operation.binding.key.attempt;
    requireRule(b.organizationId === a.organizationId && b.workspaceId === a.workspaceId && b.attemptId === a.attemptId
      && b.intentDigest === a.intentDigest && b.generation === a.generation && b.journalAuthority === operation.binding.journalAuthority);
    return source;
  }
  if (operation.kind !== 'outputScan') {
    captureOutputState(copy as OutputCustodyState, operation.kind === 'outputAdopt' ? operation.request.binding : operation.binding);
    return copy as OutputCustodyState;
  }
  return capturePage(copy, operation.query.limit);
}

function capturePage(copy: unknown, limit: number): OutputPage {
  const page = copy as OutputPage; closed(page, ['items', 'nextCursor']);
  requireRule(Array.isArray(page.items) && page.items.length <= limit);
  requireRule(page.nextCursor === null || typeof page.nextCursor === 'string' && Buffer.byteLength(page.nextCursor) <= 1024);
  page.items.forEach(item => {
    closed(item, item.kind === 'ready' ? ['kind', 'order', 'after', 'binding'] : ['kind', 'order', 'after', 'key']);
    natural(item.order); requireRule(typeof item.after === 'string' && Buffer.byteLength(item.after) <= 1024);
    if (item.kind === 'ready') captureEventBinding(item.binding);
    else { requireRule(item.kind === 'unbound'); captureEventKey(item.key); }
  });
  return page;
}
