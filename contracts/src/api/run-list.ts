import { encodeJson } from '../json.js';
import { validateApi } from './validate.js';
import type { RunListQuery, WorkspaceScope } from './generated/types.js';

export type NormalizedRunListQuery = RunListQuery & { order: 'newest' | 'oldest' };
export interface RunListPosition {
  scope: WorkspaceScope;
  query: NormalizedRunListQuery;
  requestedAt: string;
  id: string;
}
/** Bounded copy before interpretation. Defaults belong to this owner, not AJV. */
export function normalizeRunListQuery(input: RunListQuery): NormalizedRunListQuery {
  const copy: unknown = JSON.parse(encodeJson(input, 2048));
  const checked = validateApi('RunListQuery', copy);
  if (!checked.ok) throw new Error('Invalid run list query');
  return { ...checked.value, order: checked.value.order ?? 'newest' };
}
function scope(input: WorkspaceScope): WorkspaceScope {
  const copy: unknown = JSON.parse(encodeJson(input, 512));
  const checked = validateApi('WorkspaceScope', copy);
  if (!checked.ok) throw new Error('Invalid run list scope');
  return { kind: 'workspace', organizationId: checked.value.organizationId.toLowerCase(),
    workspaceId: checked.value.workspaceId.toLowerCase() };
}
export function runListTimestamp(input: string): boolean {
  if (typeof input !== 'string' || input.length !== 24) return false;
  const time = Date.parse(input);
  return Number.isFinite(time) && new Date(time).toISOString() === input;
}
/** Fixed ASCII tuple; callers are captured before any identity is interpreted. */
export function encodeRunListCursor(input: RunListPosition): string {
  const copy = JSON.parse(encodeJson(input, 2048)) as RunListPosition;
  if (Object.keys(copy).length !== 4 || !runListTimestamp(copy.requestedAt) || !validateApi('Uuid', copy.id).ok) {
    throw new Error('Invalid run list position');
  }
  const owner = scope(copy.scope);
  const query = normalizeRunListQuery(copy.query);
  const tuple = ['run-page-v1', owner.organizationId, owner.workspaceId, query.limit,
    query.state ?? null, query.outcome ?? null, query.order, copy.requestedAt, copy.id.toLowerCase()];
  const encoded = btoa(JSON.stringify(tuple)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (encoded.length > 512) throw new Error('Run list cursor limit');
  return encoded;
}
export function captureRunListCursor(input: string): RunListPosition {
  if (typeof input !== 'string' || input.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error('Invalid run list cursor');
  }
  const tuple: unknown = JSON.parse(atob(input.replaceAll('-', '+').replaceAll('_', '/')));
  if (!Array.isArray(tuple) || tuple.length !== 9 || tuple[0] !== 'run-page-v1') throw new Error('Invalid run list cursor');
  const query = normalizeRunListQuery({ limit: tuple[3] as number,
    ...(tuple[4] === null ? {} : { state: tuple[4] }), ...(tuple[5] === null ? {} : { outcome: tuple[5] }),
    order: tuple[6] } as RunListQuery);
  const position = { scope: scope({ kind: 'workspace', organizationId: tuple[1], workspaceId: tuple[2] }),
    query, requestedAt: tuple[7] as string, id: tuple[8] as string };
  if (encodeRunListCursor(position) !== input) throw new Error('Noncanonical run list cursor');
  return position;
}
function identity(owner: WorkspaceScope, query: NormalizedRunListQuery): string {
  const s = scope(owner);
  return JSON.stringify([s.organizationId, s.workspaceId, query.limit, query.state ?? null, query.outcome ?? null, query.order]);
}
/** Rejects legacy cursors and mismatched queries before repository/fetch work. */
export function runListPosition(owner: WorkspaceScope, input: RunListQuery): RunListPosition | null {
  const query = normalizeRunListQuery(input);
  const captured = scope(owner);
  if (query.cursor === undefined) return null;
  const position = captureRunListCursor(query.cursor);
  if (identity(position.scope, position.query) !== identity(captured, query)) throw new Error('Run list cursor binding');
  return position;
}
export function compareRunListPosition(left: { requestedAt: string; id: string }, right: { requestedAt: string; id: string }): number {
  if (left.requestedAt !== right.requestedAt) return left.requestedAt < right.requestedAt ? -1 : 1;
  const a = left.id.toLowerCase(); const b = right.id.toLowerCase();
  return a === b ? 0 : a < b ? -1 : 1;
}
