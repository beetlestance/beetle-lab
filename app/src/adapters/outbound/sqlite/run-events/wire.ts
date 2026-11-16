import { validateApi, runEventPageMatches } from '@beetle/contracts/api';
import type { RunEventPage } from '@beetle/contracts/api';
import type { RunEventsQuery } from '../../../../ports/run-events.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { boundedCopy, lower } from '../input-values.js';
import type { Operation } from '../protocol.js';

export type RunEventsOperation = Extract<Operation, { kind: 'getRunEvents' }>;
export function runEventsOperation(input: unknown): input is RunEventsOperation {
  if (!input || typeof input !== 'object') return false;
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!kind && 'value' in kind && kind.value === 'getRunEvents';
}
export function captureRunEventsOperation(input: unknown): RunEventsOperation {
  const copy = boundedCopy(input, 4096) as RunEventsOperation & { messageId?: number };
  requireRule(runEventsOperation(copy) && Object.keys(copy).every(key => ['kind', 'query', 'messageId'].includes(key)));
  if (Object.hasOwn(copy, 'messageId')) requireRule(Number.isSafeInteger(copy.messageId) && copy.messageId! > 0);
  const q = copy.query;
  requireRule(q !== null && typeof q === 'object' && Object.keys(q).every(key => ['scope', 'id', 'limit', 'cursor'].includes(key)));
  requireRule(validateApi('WorkspaceScope', q.scope).ok && validateApi('Uuid', q.id).ok
    && validateApi('PageQuery', { limit: q.limit, ...(q.cursor === undefined ? {} : { cursor: q.cursor }) }).ok);
  return { kind: 'getRunEvents', query: { id: lower(q.id), scope: { kind: 'workspace',
    organizationId: lower(q.scope.organizationId), workspaceId: lower(q.scope.workspaceId) }, limit: q.limit,
  ...(q.cursor === undefined ? {} : { cursor: q.cursor }) } };
}
export function captureRunEventsReply(query: RunEventsQuery, input: unknown): RunEventPage {
  const checked = validateApi('RunEventPage', boundedCopy(input, 262144));
  requireRule(checked.ok && runEventPageMatches(checked.value, query));
  return checked.value;
}
