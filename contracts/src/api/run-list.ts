import { normalizeRunSearchName, normalizeRunIdPrefix } from './run-search.js';
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
  return {
    ...checked.value,
    order: checked.value.order ?? 'newest',
    ...(checked.value.name === undefined ? {} : { name: normalizeRunSearchName(checked.value.name) }),
    ...(checked.value.runIdPrefix === undefined
      ? {}
      : { runIdPrefix: normalizeRunIdPrefix(checked.value.runIdPrefix) }),
    ...(checked.value.suiteId === undefined ? {} : { suiteId: checked.value.suiteId.toLowerCase() }),
  };
}
function scope(input: unknown): WorkspaceScope {
  const copy: unknown = JSON.parse(encodeJson(input, 512));
  const checked = validateApi('WorkspaceScope', copy);
  if (!checked.ok) throw new Error('Invalid run list scope');
  return {
    kind: 'workspace',
    organizationId: checked.value.organizationId.toLowerCase(),
    workspaceId: checked.value.workspaceId.toLowerCase(),
  };
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
  const search = query.name !== undefined || query.runIdPrefix !== undefined;
  const tuple = positionTuple({ ...copy, scope: owner, query }, search);
  const bytes = new TextEncoder().encode(JSON.stringify(tuple));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  if (encoded.length > (query.suiteId === undefined && query.pinned !== true ? 512 : 1024))
    throw new Error('Run list cursor limit');
  return encoded;
}
export function captureRunListCursor(input: string): RunListPosition {
  if (typeof input !== 'string' || input.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new Error('Invalid run list cursor');
  }
  const tuple = decodePositionTuple(input);
  const query = tupleQuery(tuple);
  const position = {
    scope: scope({ kind: 'workspace', organizationId: tuple[1], workspaceId: tuple[2] }),
    query,
    requestedAt: tuple[7] as string,
    id: tuple[8] as string,
  };
  if (encodeRunListCursor(position) !== input) throw new Error('Noncanonical run list cursor');
  return position;
}
function identity(owner: WorkspaceScope, query: NormalizedRunListQuery): string {
  const s = scope(owner);
  return JSON.stringify([
    s.organizationId,
    s.workspaceId,
    query.limit,
    query.state ?? null,
    query.outcome ?? null,
    query.order,
    query.name ?? null,
    query.runIdPrefix ?? null,
    query.suiteId ?? null,
    query.pinned ?? null,
  ]);
}
/** Rejects legacy cursors and mismatched queries before repository/fetch work. */
export function runListPosition(owner: WorkspaceScope, input: RunListQuery): RunListPosition | null {
  const query = normalizeRunListQuery(input);
  const captured = scope(owner);
  if (query.cursor === undefined) return null;
  const position = captureRunListCursor(query.cursor);
  if (identity(position.scope, position.query) !== identity(captured, query))
    throw new Error('Run list cursor binding');
  return position;
}
export function compareRunListPosition(
  left: { requestedAt: string; id: string },
  right: { requestedAt: string; id: string },
): number {
  if (left.requestedAt !== right.requestedAt) return left.requestedAt < right.requestedAt ? -1 : 1;
  const a = left.id.toLowerCase();
  const b = right.id.toLowerCase();
  return a === b ? 0 : a < b ? -1 : 1;
}

function positionTuple(position: RunListPosition, search: boolean): unknown[] {
  const { scope: owner, query } = position;
  return [
    tupleVersion(query, search),
    owner.organizationId,
    owner.workspaceId,
    query.limit,
    query.state ?? null,
    query.outcome ?? null,
    query.order,
    position.requestedAt,
    position.id.toLowerCase(),
    ...tupleTail(query, search),
  ];
}
function tupleVersion(query: NormalizedRunListQuery, search: boolean): string {
  if (query.pinned === true) return 'run-page-v4';
  if (query.suiteId !== undefined) return 'run-page-v3';
  return search ? 'run-page-v2' : 'run-page-v1';
}
/** v2 adds search, v3 the exact suite, v4 the pinned filter with every optional slot. */
function tupleTail(query: NormalizedRunListQuery, search: boolean): unknown[] {
  const searched = [query.name ?? null, query.runIdPrefix ?? null];
  if (query.pinned === true) return [...searched, query.suiteId ?? null, true];
  if (query.suiteId !== undefined) return [...searched, query.suiteId];
  return search ? searched : [];
}
function decodePositionTuple(input: string): unknown[] {
  const binary = atob(input.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const tuple: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(tuple) || !validTupleVersion(tuple)) throw new Error('Invalid run list cursor');
  return tuple;
}
const TUPLE_SHAPES = new Map<unknown, { length: number; valid(tuple: unknown[]): boolean }>([
  ['run-page-v1', { length: 9, valid: () => true }],
  ['run-page-v2', { length: 11, valid: (tuple) => tuple[9] !== null || tuple[10] !== null }],
  ['run-page-v3', { length: 12, valid: (tuple) => typeof tuple[11] === 'string' }],
  ['run-page-v4', { length: 13, valid: (tuple) => tuple[12] === true }],
]);
function validTupleVersion(tuple: unknown[]): boolean {
  const shape = TUPLE_SHAPES.get(tuple[0]);
  return shape !== undefined && tuple.length === shape.length && shape.valid(tuple);
}
function tupleQuery(tuple: unknown[]): NormalizedRunListQuery {
  return normalizeRunListQuery({
    limit: tuple[3],
    order: tuple[6],
    ...(tuple[4] === null ? {} : { state: tuple[4] }),
    ...(tuple[5] === null ? {} : { outcome: tuple[5] }),
    ...(tuple[11] == null ? {} : { suiteId: tuple[11] }),
    ...(tuple[9] == null ? {} : { name: tuple[9] }),
    ...(tuple[10] == null ? {} : { runIdPrefix: tuple[10] }),
    ...(tuple[12] === true ? { pinned: true } : {}),
  } as RunListQuery);
}
