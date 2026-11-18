import { validateApi } from './validate.js';
import type { PageQuery, SuiteRevisionPage, WorkspaceScope } from './generated/types.js';

export interface RevisionListPosition {
  scope: WorkspaceScope;
  suiteId: string;
  limit: number;
  ordinal: number;
  id: string;
}
const TAG = 'revision-ordinal-desc-v1';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;

/** Closed ASCII tuple. The cursor is a position, never read authority. */
export function encodeRevisionListCursor(value: RevisionListPosition): string {
  if (
    !validateApi('WorkspaceScope', value.scope).ok ||
    !validateApi('Uuid', value.suiteId).ok ||
    !validateApi('Uuid', value.id).ok ||
    !positive(value.limit) ||
    value.limit > 100 ||
    !positive(value.ordinal)
  )
    throw Error('Invalid revision position');
  return btoa(
    JSON.stringify([
      TAG,
      value.scope.organizationId.toLowerCase(),
      value.scope.workspaceId.toLowerCase(),
      value.suiteId.toLowerCase(),
      value.limit,
      value.ordinal,
      value.id.toLowerCase(),
    ]),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
function tupleOf(input: string): unknown[] {
  if (input.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input)) throw Error('Invalid revision cursor');
  const tuple: unknown = JSON.parse(atob(input.replaceAll('-', '+').replaceAll('_', '/')));
  if (!Array.isArray(tuple) || tuple.length !== 7 || tuple[0] !== TAG) throw Error('Invalid revision tuple');
  return tuple;
}
function capture(input: string): RevisionListPosition {
  const tuple = tupleOf(input);
  const scope = validateApi('WorkspaceScope', { kind: 'workspace', organizationId: tuple[1], workspaceId: tuple[2] });
  const suite = validateApi('Uuid', tuple[3]);
  const id = validateApi('Uuid', tuple[6]);
  if (!scope.ok || !suite.ok || !id.ok) throw Error('Invalid revision owner');
  if (!positive(tuple[4]) || tuple[4] > 100 || !positive(tuple[5])) throw Error('Invalid revision position');
  const position = { scope: scope.value, suiteId: suite.value, limit: tuple[4], ordinal: tuple[5], id: id.value };
  if (encodeRevisionListCursor(position) !== input) throw Error('Noncanonical revision cursor');
  return position;
}
/** Scope, suite and page size bind every continuation before repository work. */
export function revisionListPosition(
  scope: WorkspaceScope,
  suiteId: string,
  query: PageQuery,
): RevisionListPosition | null {
  if (
    !validateApi('WorkspaceScope', scope).ok ||
    !validateApi('Uuid', suiteId).ok ||
    !validateApi('PageQuery', query).ok
  )
    throw Error('Invalid revision query');
  if (query.cursor === undefined) return null;
  const value = capture(query.cursor);
  if (
    !same(value.scope.organizationId, scope.organizationId) ||
    !same(value.scope.workspaceId, scope.workspaceId) ||
    !same(value.suiteId, suiteId) ||
    value.limit !== query.limit
  )
    throw Error('Revision cursor binding');
  return value;
}
/** Strict descending ordinals, unique IDs, predecessor consistency and exact continuation. */
export function revisionListPageMatches(
  page: SuiteRevisionPage,
  scope: WorkspaceScope,
  suiteId: string,
  query: PageQuery,
): boolean {
  try {
    const position = revisionListPosition(scope, suiteId, query);
    if (!pageOwnerMatches(page, scope, suiteId) || page.items.length > query.limit) return false;
    if (!orderedRows(page, scope, suiteId, position) || !predecessorsMatch(page)) return false;
    return continuationMatches(page, scope, suiteId, query.limit);
  } catch {
    return false;
  }
}
function pageOwnerMatches(page: SuiteRevisionPage, scope: WorkspaceScope, suiteId: string): boolean {
  return (
    same(page.scope.organizationId, scope.organizationId) &&
    same(page.scope.workspaceId, scope.workspaceId) &&
    same(page.suiteId, suiteId)
  );
}
function owns(item: SuiteRevisionPage['items'][number], scope: WorkspaceScope, suiteId: string): boolean {
  return (
    same(item.scope.organizationId, scope.organizationId) &&
    same(item.scope.workspaceId, scope.workspaceId) &&
    same(item.suiteId, suiteId)
  );
}
function orderedRows(
  page: SuiteRevisionPage,
  scope: WorkspaceScope,
  suiteId: string,
  position: RevisionListPosition | null,
): boolean {
  const seen = new Set<string>(position ? [position.id.toLowerCase()] : []);
  let before = position?.ordinal ?? Infinity;
  for (const item of page.items) {
    if (!owns(item, scope, suiteId) || item.ordinal >= before || seen.has(item.id.toLowerCase())) return false;
    seen.add(item.id.toLowerCase());
    before = item.ordinal;
  }
  return true;
}
function predecessorsMatch(page: SuiteRevisionPage): boolean {
  return page.items.every((item, index) => {
    const previous = item.previousRevisionId;
    if (previous !== null && same(previous, item.id)) return false;
    if (item.ordinal === 1 && previous !== null) return false;
    const next = page.items[index + 1];
    return next === undefined || (previous !== null && same(previous, next.id));
  });
}
function continuationMatches(page: SuiteRevisionPage, scope: WorkspaceScope, suiteId: string, limit: number): boolean {
  const last = page.items.at(-1);
  if (page.nextCursor === null) return last === undefined || last.previousRevisionId === null;
  return (
    last !== undefined &&
    last.previousRevisionId !== null &&
    page.items.length === limit &&
    page.nextCursor === encodeRevisionListCursor({ scope, suiteId, limit, ordinal: last.ordinal, id: last.id })
  );
}
