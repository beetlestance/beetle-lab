import { normalizeRunSearchName } from './run-search.js';
import { encodeJson } from '../json.js';
import { validateApi } from './validate.js';
import type { Run, SuiteGroup, SuiteListQuery, WorkspaceScope } from './generated/types.js';

export type NormalizedSuiteListQuery = SuiteListQuery & { order: 'recent_run' | 'name' };
/** `requestedAt` is the last suite's latest retained Run time (null: no runs); name order keeps only the UUID. */
export interface SuiteListPosition {
  scope: WorkspaceScope;
  query: NormalizedSuiteListQuery;
  requestedAt: string | null;
  id: string;
}
export const SUITE_GROUPS = Object.freeze([
  'in_progress',
  'passed',
  'failed',
  'inconclusive',
  'stopped',
  'no_runs',
] as const satisfies readonly SuiteGroup[]);
const TAG = 'suite-page-v1';

/** Display group of a suite from its latest retained Run; `null` means none is retained. */
export function suiteGroupOf(run: Pick<Run, 'state' | 'outcome'> | null): SuiteGroup {
  if (run === null) return 'no_runs';
  if (['queued', 'dispatching', 'active', 'finalizing'].includes(run.state)) return 'in_progress';
  if (run.state === 'finished' && run.outcome !== 'pending') return run.outcome;
  return 'stopped';
}
/** Bounded copy before interpretation. Defaults belong to this owner, not AJV. */
export function normalizeSuiteListQuery(input: SuiteListQuery): NormalizedSuiteListQuery {
  const copy: unknown = JSON.parse(encodeJson(input, 2048));
  const checked = validateApi('SuiteListQuery', copy);
  if (!checked.ok) throw new Error('Invalid suite list query');
  const value = checked.value;
  return {
    ...value,
    order: value.order ?? 'recent_run',
    ...(value.name === undefined ? {} : { name: normalizeRunSearchName(value.name) }),
    ...(value.folderId === undefined ? {} : { folderId: value.folderId.toLowerCase() }),
  };
}
function scope(input: unknown): WorkspaceScope {
  const copy: unknown = JSON.parse(encodeJson(input, 512));
  const checked = validateApi('WorkspaceScope', copy);
  if (!checked.ok) throw new Error('Invalid suite list scope');
  return {
    kind: 'workspace',
    organizationId: checked.value.organizationId.toLowerCase(),
    workspaceId: checked.value.workspaceId.toLowerCase(),
  };
}
function identity(owner: WorkspaceScope, query: NormalizedSuiteListQuery): unknown[] {
  const s = scope(owner);
  return [
    s.organizationId,
    s.workspaceId,
    query.limit,
    query.folderId ?? null,
    query.group ?? null,
    query.engineId ?? null,
    query.order,
    query.name ?? null,
  ];
}
function validTime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return value.length === 24 && Number.isFinite(time) && new Date(time).toISOString() === value;
}
function validPosition(position: SuiteListPosition): boolean {
  if (!validateApi('Uuid', position.id).ok) return false;
  if (position.query.order === 'name') return position.requestedAt === null;
  return position.requestedAt === null || validTime(position.requestedAt);
}
/** Fixed ASCII tuple: version, binding fields, then the last position. */
export function encodeSuiteListCursor(input: SuiteListPosition): string {
  const copy = JSON.parse(encodeJson(input, 2048)) as SuiteListPosition;
  if (Object.keys(copy).length !== 4) throw new Error('Invalid suite list position');
  const query = normalizeSuiteListQuery(copy.query);
  const position = { ...copy, scope: scope(copy.scope), query };
  if (!validPosition(position)) throw new Error('Invalid suite list position');
  const tuple = [TAG, ...identity(position.scope, query), position.requestedAt, position.id.toLowerCase()];
  const bytes = new TextEncoder().encode(JSON.stringify(tuple));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  if (encoded.length > 512) throw new Error('Suite list cursor limit');
  return encoded;
}
function decodeTuple(input: string): unknown[] {
  const binary = atob(input.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const tuple: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(tuple) || tuple.length !== 11 || tuple[0] !== TAG) throw new Error('Invalid suite list cursor');
  return tuple;
}
export function captureSuiteListCursor(input: string): SuiteListPosition {
  if (typeof input !== 'string' || input.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input))
    throw new Error('Invalid suite list cursor');
  const t = decodeTuple(input);
  const query = normalizeSuiteListQuery({
    limit: t[3],
    order: t[7],
    ...(t[4] === null ? {} : { folderId: t[4] }),
    ...(t[5] === null ? {} : { group: t[5] }),
    ...(t[6] === null ? {} : { engineId: t[6] }),
    ...(t[8] === null ? {} : { name: t[8] }),
  } as SuiteListQuery);
  const position = {
    scope: scope({ kind: 'workspace', organizationId: t[1], workspaceId: t[2] }),
    query,
    requestedAt: t[9] as string | null,
    id: t[10] as string,
  };
  if (encodeSuiteListCursor(position) !== input) throw new Error('Noncanonical suite list cursor');
  return position;
}
/** Rejects foreign, legacy and mismatched cursors before repository work. */
export function suiteListPosition(owner: WorkspaceScope, input: SuiteListQuery): SuiteListPosition | null {
  const query = normalizeSuiteListQuery(input);
  if (query.cursor === undefined) return null;
  const position = captureSuiteListCursor(query.cursor);
  if (JSON.stringify(identity(position.scope, position.query)) !== JSON.stringify(identity(scope(owner), query)))
    throw new Error('Suite list cursor binding');
  return position;
}
