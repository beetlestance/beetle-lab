import { revisionListPosition } from '../revision-list.js';
import { normalizeRunListQuery, runListPosition } from '../run-list.js';
import { normalizeSuiteListQuery, suiteListPosition } from '../suite-list.js';
import { encodeJson } from '../../json.js';
import type { ApiOperation } from '../generated/operations.js';
import type { ApiTypes } from '../generated/types.js';
import { validateApi } from '../validate.js';

export interface PreparedInput {
  params: Record<string, string>;
  query?:
    | ApiTypes['InputColumnsQuery']
    | ApiTypes['PageQuery']
    | ApiTypes['RunMetricSamplesQuery']
    | ApiTypes['RunListQuery']
    | ApiTypes['SuiteListQuery'];
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

function allowedFields(operation: ApiOperation): string[] {
  return [
    'signal',
    ...('params' in operation ? ['params'] : []),
    ...('query' in operation ? ['query'] : []),
    ...('request' in operation ? ['body'] : []),
  ];
}
function fields(operation: ApiOperation, input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)
  )
    throw new Error('input');
  const result: Record<string, unknown> = {};
  const allowed = allowedFields(operation);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new Error('input');
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !('value' in property)) throw new Error('input');
    result[key] = property.value;
  }
  return result;
}

function validateFields(operation: ApiOperation, snapshot: Record<string, unknown>): boolean {
  if ('params' in operation && !validateApi(operation.params, snapshot.params).ok) return false;
  if ('query' in operation && !validateApi(operation.query, snapshot.query).ok) return false;
  return !('request' in operation) || validateApi(operation.request, snapshot.body).ok;
}

function callerSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof AbortSignal)) throw new Error('signal');
  // Native composition checks the signal brand and preserves caller cancellation.
  return AbortSignal.any([value]);
}

/** Snapshot before validation, URI encoding or any asynchronous work. Exceptions stay private. */
export function prepareInput(operation: ApiOperation, input: unknown, maximum: number): PreparedInput | undefined {
  try {
    const extracted = fields(operation, input);
    const signal = callerSignal(extracted.signal);
    delete extracted.signal;
    const snapshot = JSON.parse(encodeJson(extracted, maximum)) as Record<string, unknown>;
    if (!validateFields(operation, snapshot)) return undefined;
    const prepared: PreparedInput = { params: (snapshot.params ?? {}) as Record<string, string> };
    if ('query' in operation) prepared.query = snapshot.query as NonNullable<PreparedInput['query']>;
    normalizeListQuery(operation, prepared);
    if ('request' in operation) prepared.body = snapshot.body as Record<string, unknown>;
    if (signal !== undefined) prepared.signal = signal;
    return prepared;
  } catch {
    return undefined;
  }
}

/** Listing cursors are bound to scope and filters before any request is sent. */
function normalizeListQuery(operation: ApiOperation, prepared: PreparedInput): void {
  const owner = {
    kind: 'workspace' as const,
    organizationId: prepared.params.organizationId!,
    workspaceId: prepared.params.workspaceId!,
  };
  if (operation.name === 'listSuiteRevisions')
    revisionListPosition(owner, prepared.params.suiteId!, prepared.query as ApiTypes['PageQuery']);
  if (operation.name === 'listRuns') {
    prepared.query = normalizeRunListQuery(prepared.query as ApiTypes['RunListQuery']);
    runListPosition(owner, prepared.query);
  }
  if (operation.name === 'listSuites') {
    prepared.query = normalizeSuiteListQuery(prepared.query as ApiTypes['SuiteListQuery']);
    suiteListPosition(owner, prepared.query);
  }
}

export function operationPath(operation: ApiOperation, input: PreparedInput): string {
  const path = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) =>
    encodeURIComponent(input.params[name]!),
  );
  if (!input.query) return path;
  if ('kind' in input.query) return `${path}?${new URLSearchParams({ kind: input.query.kind }).toString()}`;
  const query = new URLSearchParams({ limit: String(input.query.limit) });
  if (input.query.cursor !== undefined) query.set('cursor', input.query.cursor);
  appendRunQuery(query, input.query);
  if ('seriesOrdinal' in input.query) {
    query.set('seriesOrdinal', String(input.query.seriesOrdinal));
    if (input.query.fromTimeMs !== undefined) query.set('fromTimeMs', String(input.query.fromTimeMs));
    if (input.query.toTimeMs !== undefined) query.set('toTimeMs', String(input.query.toTimeMs));
  }
  return `${path}?${query.toString()}`;
}

function appendSuiteQuery(query: URLSearchParams, input: NonNullable<PreparedInput['query']>): void {
  if ('folderId' in input && input.folderId !== undefined) query.set('folderId', input.folderId);
  if ('group' in input && input.group !== undefined) query.set('group', input.group);
  if ('engineId' in input && input.engineId !== undefined) query.set('engineId', input.engineId);
}

function appendRunQuery(query: URLSearchParams, input: NonNullable<PreparedInput['query']>): void {
  appendSuiteQuery(query, input);
  if ('suiteId' in input && input.suiteId !== undefined) query.set('suiteId', input.suiteId);
  if ('state' in input && input.state !== undefined) query.set('state', input.state);
  if ('outcome' in input && input.outcome !== undefined) query.set('outcome', input.outcome);
  appendRunSearch(query, input);
  if ('order' in input && input.order !== undefined) query.set('order', input.order);
  appendCounts(query, input);
}

function appendRunSearch(query: URLSearchParams, input: NonNullable<PreparedInput['query']>): void {
  if ('name' in input && input.name !== undefined) query.set('name', input.name);
  if ('runIdPrefix' in input && input.runIdPrefix !== undefined) query.set('runIdPrefix', input.runIdPrefix);
  if ('pinned' in input && input.pinned === true) query.set('pinned', 'true');
}

function appendCounts(query: URLSearchParams, input: NonNullable<PreparedInput['query']>): void {
  if ('includeCounts' in input && input.includeCounts === true) query.set('includeCounts', 'true');
}
