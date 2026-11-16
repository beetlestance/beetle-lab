import { encodeJson } from '../../json.js';
import { validateApi } from '../validate.js';
import type { RunEventPage, WorkspaceScope } from '../generated/types.js';

interface Position {
  organizationId: string; workspaceId: string; runId: string; attemptId: string; generation: 1; afterSeq: number;
}
interface Query { id: string; scope: WorkspaceScope; limit: number; cursor?: string }
const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/** Closed ASCII cursor, canonical base64url, with lowercase UUID identities. */
export function encodeRunEventCursor(value: Position): string {
  if (!validPosition(value)) throw new Error('cursor');
  const json = JSON.stringify({ organizationId: value.organizationId.toLowerCase(), workspaceId: value.workspaceId.toLowerCase(),
    runId: value.runId.toLowerCase(), attemptId: value.attemptId.toLowerCase(), generation: 1, afterSeq: value.afterSeq });
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function captureRunEventCursor(input: string): Position {
  if (typeof input !== 'string' || input.length < 1 || input.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error('cursor');
  const value: unknown = JSON.parse(atob(input.replaceAll('-', '+').replaceAll('_', '/')));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('cursor');
  const p = value as Position;
  if (!validPosition(p) || encodeRunEventCursor(p) !== input) throw new Error('cursor');
  return p;
}
function validPosition(p: Position): boolean {
  const keys = ['organizationId', 'workspaceId', 'runId', 'attemptId', 'generation', 'afterSeq'];
  return Reflect.ownKeys(p).length === keys.length
    && keys.every(key => Object.getOwnPropertyDescriptor(p, key)?.value !== undefined)
    && [p.organizationId, p.workspaceId, p.runId, p.attemptId].every(id => validateApi('Uuid', id).ok)
    && p.generation === 1 && Number.isSafeInteger(p.afterSeq) && p.afterSeq >= 0 && p.afterSeq <= 65536;
}
function positionMatches(p: Position, page: RunEventPage): boolean {
  return same(p.organizationId, page.scope.organizationId) && same(p.workspaceId, page.scope.workspaceId)
    && same(p.runId, page.id) && same(p.attemptId, page.activeAttemptId) && p.generation === page.generation;
}
function coverageMatches(page: RunEventPage): boolean {
  if (page.coverage === 'pending') return page.durableThrough === 0 && page.items.length === 0
    && page.blockedReason === null && page.retainedStartSeq === null;
  if (page.blockedReason === 'cursor_expired') return page.coverage === 'partial'
    && page.retainedStartSeq !== null && page.retainedStartSeq > page.durableThrough + 1;
  return page.coverage === 'contiguous' && page.retainedStartSeq === null;
}
/** Schema validation precedes semantic scope, cursor, ordering and complete byte bounds. */
export function runEventPageMatches(page: RunEventPage, query: Query): boolean {
  try {
    encodeJson(page, 262144);
    return Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100
      && requestedPosition(page, query) && returnedPosition(page)
      && page.items.length <= query.limit && coverageMatches(page) && eventsMatch(page);
  } catch { return false; }
}
function requestedPosition(page: RunEventPage, query: Query): boolean {
  const start = query.cursor === undefined ? null : captureRunEventCursor(query.cursor);
  return same(query.id, page.id) && same(query.scope.organizationId, page.scope.organizationId)
    && same(query.scope.workspaceId, page.scope.workspaceId) && page.generation === 1
    && page.afterSeq === (start?.afterSeq ?? 0) && (start === null || positionMatches(start, page));
}
function returnedPosition(page: RunEventPage): boolean {
  const resume = captureRunEventCursor(page.resumeCursor);
  const last = page.afterSeq + page.items.length;
  return positionMatches(resume, page) && resume.afterSeq === last && last <= page.durableThrough
    && (last === page.durableThrough || page.items.length > 0)
    && page.nextCursor === (last < page.durableThrough ? page.resumeCursor : null);
}
function eventsMatch(page: RunEventPage): boolean {
  return page.items.every((event, index) => event.seq === page.afterSeq + index + 1 && event.generation === page.generation
    && same(event.attemptId, page.activeAttemptId) && same(event.organizationId, page.scope.organizationId)
    && same(event.workspaceId, page.scope.workspaceId) && encodeJson(event, 65536).length > 0);
}
