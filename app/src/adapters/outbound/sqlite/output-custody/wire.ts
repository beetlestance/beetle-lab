import { encodeCanonicalJson } from '@beetle/contracts';
import { verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import { captureEventBinding, captureEventKey } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { OutputCustodyState, OutputPage } from '../../../../ports/output-custody.js';
import type { Operation } from '../protocol.js';
import { boundedCopy, sha256 } from '../input-values.js';
import { closed, natural, scanQuery, token } from './values.js';
export type OutputOperation = Exclude<Extract<Operation, {kind: 'outputScan' | 'outputLoad' | 'outputReadSource' | 'outputAdopt'}>, {kind: 'outputAdopt'}>
  | {kind: 'outputAdopt'; request: {binding: ReturnType<typeof captureEventBinding>; envelope: Owned<SourceEnvelope>}};
export type OutputValue = OutputCustodyState | OutputPage | Owned<SourceEnvelope> | null;
const kinds = ['outputScan', 'outputLoad', 'outputReadSource', 'outputAdopt'];
export function outputOperation(input: unknown): input is OutputOperation {
  if (!input || typeof input !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kinds.includes(kind.value as string);
}
export function outputReplyLimit(input: OutputOperation): number { return input.kind === 'outputReadSource' ? 75776 : 65536; }
export function captureOutputOperation(input: Operation): OutputOperation {
  const copy = boundedCopy(input, 79872);
  requireRule(outputOperation(copy));
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
function hex(input: unknown): boolean { return typeof input === 'string' && /^[a-f0-9]{64}$/.test(input); }
function state(input: OutputCustodyState, binding: ReturnType<typeof captureEventBinding>): void {
  closed(input, input.kind === 'pending' ? ['kind', 'binding'] : ['kind', 'binding', 'manifestDigest', 'sourceDigest', 'finalAgentSeq', 'version', 'artifacts']);
  requireRule(encodeCanonicalJson(captureEventBinding(input.binding), 4096) === encodeCanonicalJson(binding, 4096));
  if (input.kind === 'pending') return;
  requireRule(input.kind === 'adopted' && input.version === 1 && Array.isArray(input.artifacts) && input.artifacts.length <= 128);
  requireRule(hex(input.manifestDigest) && hex(input.sourceDigest)); natural(input.finalAgentSeq);
  const tokens = new Set<string>();
  input.artifacts.forEach((artifact, index) => {
    closed(artifact, ['ordinal', 'artifactId', 'token', 'bytes', 'sha256', 'offset', 'phase', 'identity', 'writer', 'version']);
    requireRule(artifact.ordinal === index && artifact.version === 1 && artifact.phase === 'transferring');
    requireRule(artifact.identity === null && artifact.writer === null && artifact.offset === 0);
    requireRule(typeof artifact.artifactId === 'string' && Buffer.byteLength(artifact.artifactId) <= 128);
    requireRule(hex(artifact.sha256)); natural(artifact.bytes); token(artifact.token);
    requireRule(!tokens.has(artifact.token)); tokens.add(artifact.token);
  });
}
export function captureOutputReply(operation: OutputOperation, input: unknown): OutputValue {
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
    state(copy as OutputCustodyState, operation.kind === 'outputAdopt' ? operation.request.binding : operation.binding);
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
