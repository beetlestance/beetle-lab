import { encodeJson } from '../../json.js';
import { validateApi } from '../validate.js';
import type { RunArtifactPage, WorkspaceScope } from '../generated/types.js';

interface Position {
  lane: 'artifacts'; organizationId: string; workspaceId: string; runId: string; attemptId: string;
  generation: 1; manifestDigest: string; ordinal: number;
}
interface Query { id: string; scope: WorkspaceScope; attemptId: string; limit: number; cursor?: string }
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
function valid(p: Position): boolean {
  const keys = ['lane', 'organizationId', 'workspaceId', 'runId', 'attemptId', 'generation', 'manifestDigest', 'ordinal'];
  return Reflect.ownKeys(p).length === keys.length && keys.every(k => Object.getOwnPropertyDescriptor(p, k)?.value !== undefined)
    && p.lane === 'artifacts' && p.generation === 1 && typeof p.manifestDigest === 'string' && /^[a-f0-9]{64}$/.test(p.manifestDigest)
    && [p.organizationId, p.workspaceId, p.runId, p.attemptId].every(id => validateApi('Uuid', id).ok)
    && Number.isSafeInteger(p.ordinal) && p.ordinal >= 1 && p.ordinal < 128;
}
export function encodeRunArtifactCursor(p: Position): string {
  if (!valid(p)) throw new Error('cursor');
  return btoa(JSON.stringify({ lane: 'artifacts', organizationId: p.organizationId.toLowerCase(), workspaceId: p.workspaceId.toLowerCase(),
    runId: p.runId.toLowerCase(), attemptId: p.attemptId.toLowerCase(), generation: 1, manifestDigest: p.manifestDigest, ordinal: p.ordinal }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function captureRunArtifactCursor(input: string): Position {
  if (typeof input !== 'string' || input.length < 1 || input.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error('cursor');
  const p: unknown = JSON.parse(atob(input.replaceAll('-', '+').replaceAll('_', '/')));
  if (!p || typeof p !== 'object' || Array.isArray(p) || !valid(p as Position)
    || encodeRunArtifactCursor(p as Position) !== input) throw new Error('cursor');
  return p as Position;
}
function matches(p: Position, page: RunArtifactPage): boolean {
  return same(p.runId, page.id) && same(p.attemptId, page.attemptId) && same(p.organizationId, page.scope.organizationId)
    && same(p.workspaceId, page.scope.workspaceId) && p.manifestDigest === page.manifestDigest;
}
function identity(page: RunArtifactPage, query: Query): boolean {
  return same(page.id, query.id) && same(page.attemptId, query.attemptId) && page.generation === 1
    && same(page.scope.organizationId, query.scope.organizationId) && same(page.scope.workspaceId, query.scope.workspaceId);
}
function ready(page: RunArtifactPage, query: Query, start: Position | null): boolean {
  if (page.manifestDigest === null || new Set(page.items.map(a => a.artifactId.toLowerCase())).size !== page.items.length) return false;
  const ordinal = (start?.ordinal ?? 0) + page.items.length;
  if (ordinal > 128 || (start && page.items.length === 0)) return false;
  return nextPosition(page, query, ordinal);
}
function nextPosition(page: RunArtifactPage, query: Query, ordinal: number): boolean {
  if (page.nextCursor === null) return true;
  const next = captureRunArtifactCursor(page.nextCursor);
  return page.items.length === query.limit && matches(next, page) && next.ordinal === ordinal;
}
function availability(page: RunArtifactPage, query: Query): boolean {
  const start = query.cursor === undefined ? null : captureRunArtifactCursor(query.cursor);
  if (start && !matches(start, page)) return false;
  if (page.availability === 'ready') return ready(page, query, start);
  return page.manifestDigest === null && page.items.length === 0 && page.nextCursor === null && !start;
}
/** Structural schema validation precedes semantic ownership and complete byte bounds. */
export function runArtifactPageMatches(page: RunArtifactPage, query: Query): boolean {
  try {
    encodeJson(page, 73728);
    return identity(page, query) && Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100
      && page.items.length <= query.limit && availability(page, query);
  } catch { return false; }
}
