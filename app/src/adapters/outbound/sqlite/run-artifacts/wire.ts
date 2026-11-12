import { validateApi, runArtifactPageMatches, captureRunArtifactCursor } from '@beetle/contracts/api';
import type { RunArtifactPage } from '@beetle/contracts/api';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { decodeArtifact } from '../output-custody/index.js';
import { boundedCopy, lower } from '../input-values.js';
import type { PublishedArtifactRead, RunArtifactKey, RunArtifactListQuery } from '../../../../ports/run-artifacts.js';
import type { EventBinding } from '../../../../ports/events.js';
import type { Operation } from '../protocol.js';
export type ArtifactReadOperation = Extract<Operation, {kind: 'listRunArtifacts' | 'getRunArtifact'}>;
export function artifactReadOperation(input: unknown): input is ArtifactReadOperation {
  const kind = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'kind')?.value as unknown : undefined;
  return kind === 'listRunArtifacts' || kind === 'getRunArtifact';
}
export function captureArtifactReadOperation(input: unknown): ArtifactReadOperation {
  const copy = boundedCopy(input, 4096) as ArtifactReadOperation & {messageId?: number};
  requireRule(artifactReadOperation(copy));
  const list = copy.kind === 'listRunArtifacts'; const key = list ? copy.query : copy.key;
  captureHeader(copy);
  const keys = list ? ['scope', 'id', 'attemptId', 'limit', 'cursor'] : ['scope', 'id', 'attemptId', 'artifactId'];
  requireRule(key !== null && typeof key === 'object' && Object.keys(key).every(k => keys.includes(k)));
  requireRule(validateApi('WorkspaceScope', key.scope).ok && validateApi('Uuid', key.id).ok && validateApi('Uuid', key.attemptId).ok);
  const base = {id: lower(key.id), attemptId: lower(key.attemptId), scope: {kind: 'workspace' as const,
    organizationId: lower(key.scope.organizationId), workspaceId: lower(key.scope.workspaceId)}};
  if (copy.kind === 'getRunArtifact') {
    requireRule(validateApi('Uuid', copy.key.artifactId).ok);
    return {kind: copy.kind, key: {...base, artifactId: lower(copy.key.artifactId)}};
  }
  return {kind: copy.kind, query: captureList(base, copy.query)};
}
function captureList(base: Omit<RunArtifactListQuery, 'limit'>, query: RunArtifactListQuery): RunArtifactListQuery {
  requireRule(Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100);
  if (query.cursor !== undefined) captureRunArtifactCursor(query.cursor);
  return {...base, limit: query.limit, ...(query.cursor === undefined ? {} : {cursor: query.cursor})};
}

export function captureArtifactReadReply(operation: ArtifactReadOperation, input: unknown): RunArtifactPage | PublishedArtifactRead {
  if (operation.kind === 'listRunArtifacts') {
    const checked = validateApi('RunArtifactPage', boundedCopy(input, 73728)); requireRule(checked.ok);
    requireRule(runArtifactPageMatches(checked.value, operation.query)); return checked.value;
  }
  const value = boundedCopy(input, 4096) as PublishedArtifactRead;
  requireRule(value !== null && typeof value === 'object' && Object.keys(value).length === 2
    && Object.hasOwn(value, 'record') && Object.hasOwn(value, 'kind')
    && typeof value.kind === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.kind));
  return {record: captureRecord(operation.key, value.record), kind: value.kind};
}
function captureRecord(key: RunArtifactKey, input: unknown): OutputFileRecord {
  const record = boundedCopy(input, 4096) as OutputFileRecord;
  requireRule(record !== null && typeof record === 'object' && Object.keys(record).length === 2);
  const binding = captureEventBinding(record.binding); const artifact = decodeArtifact(record.artifact);
  requireBinding(binding, key);
  requireRule(artifact.artifactId === key.artifactId && artifact.phase === 'published' && artifact.offset === artifact.bytes
    && artifact.identity !== null && artifact.writer === null);
  return {binding, artifact};
}

function requireBinding(binding: EventBinding, key: RunArtifactKey): void {
  requireRule(binding.key.runId === key.id && binding.key.attempt.attemptId === key.attemptId
    && binding.key.attempt.organizationId === key.scope.organizationId && binding.key.attempt.workspaceId === key.scope.workspaceId);
}
function captureHeader(copy: ArtifactReadOperation & {messageId?: number}): void {
  const field = copy.kind === 'listRunArtifacts' ? 'query' : 'key';
  requireRule(Object.keys(copy).every(k => ['kind', field, 'messageId'].includes(k)));
  if (Object.hasOwn(copy, 'messageId')) requireRule(Number.isSafeInteger(copy.messageId) && copy.messageId! > 0);
}
