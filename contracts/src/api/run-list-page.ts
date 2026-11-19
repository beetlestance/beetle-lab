import { runHistorySummaryMatches } from './run-history-summary.js';
import type { Run, RunListQuery, RunPage, WorkspaceScope } from './generated/types.js';
import {
  compareRunListPosition,
  encodeRunListCursor,
  normalizeRunListQuery,
  runListPosition,
  runListTimestamp,
} from './run-list.js';
import type { NormalizedRunListQuery, RunListPosition } from './run-list.js';
function owns(row: Run, scope: WorkspaceScope): boolean {
  return (
    row.scope.organizationId.toLowerCase() === scope.organizationId.toLowerCase() &&
    row.scope.workspaceId.toLowerCase() === scope.workspaceId.toLowerCase()
  );
}
function accepts(row: Run, query: NormalizedRunListQuery): boolean {
  return (
    (query.state === undefined || row.state === query.state) &&
    (query.outcome === undefined || row.outcome === query.outcome) &&
    runListTimestamp(row.requestedAt) &&
    narrows(row, query)
  );
}
function narrows(row: Run, query: NormalizedRunListQuery): boolean {
  return (
    (query.pinned !== true || row.pinned === true) &&
    (query.suiteId === undefined || row.suiteId.toLowerCase() === query.suiteId) &&
    (query.runIdPrefix === undefined || row.id.toLowerCase().startsWith(query.runIdPrefix))
  );
}
function ordered(
  rows: readonly Run[],
  position: RunListPosition | null,
  scope: WorkspaceScope,
  query: NormalizedRunListQuery,
): boolean {
  const ids = new Set<string>();
  let prior: Pick<Run, 'id' | 'requestedAt'> | null = position;
  return rows.every((row) => {
    const id = row.id.toLowerCase();
    if (ids.has(id) || !owns(row, scope) || !accepts(row, query)) return false;
    ids.add(id);
    const comparison = prior === null ? null : compareRunListPosition(row, prior);
    prior = row;
    return comparison === null || (query.order === 'newest' ? comparison < 0 : comparison > 0);
  });
}
/** After schema/byte capture: scope, filters, keyset order and exact continuation. */
export function runListPageMatches(page: RunPage, owner: WorkspaceScope, input: RunListQuery): boolean {
  try {
    const query = normalizeRunListQuery(input);
    const position = runListPosition(owner, query);
    if (
      page.scope.organizationId.toLowerCase() !== owner.organizationId.toLowerCase() ||
      page.scope.workspaceId.toLowerCase() !== owner.workspaceId.toLowerCase()
    )
      return false;
    if (page.items.length > query.limit || !ordered(page.items, position, owner, query)) return false;
    if (!historyMatches(page, query)) return false;
    if (page.nextCursor === null) return true;
    const last = page.items.at(-1);
    if (!last || page.items.length !== query.limit) return false;
    return page.nextCursor === encodeRunListCursor({ scope: owner, query, requestedAt: last.requestedAt, id: last.id });
  } catch {
    return false;
  }
}

function historyMatches(page: RunPage, query: NormalizedRunListQuery): boolean {
  return (
    countsMatch(page, query) &&
    contextsMatch(page) &&
    page.summaries.length === page.items.length &&
    page.summaries.every((summary, index) => runHistorySummaryMatches(summary, page.items[index]!))
  );
}

function contextsMatch(page: RunPage): boolean {
  if (page.contexts === undefined) return true;
  return (
    page.contexts.length === page.items.length &&
    page.contexts.every((context, index) => {
      const run = page.items[index]!;
      return (
        context.runId.toLowerCase() === run.id.toLowerCase() &&
        context.suiteId.toLowerCase() === run.suiteId.toLowerCase() &&
        context.revisionId.toLowerCase() === run.revisionId.toLowerCase()
      );
    })
  );
}

/** Counts are current-snapshot facts, never estimates from the retained page. */
function countsMatch(page: RunPage, query: NormalizedRunListQuery): boolean {
  const c = page.counts;
  if (page.countsUnavailable !== undefined)
    return c === undefined && query.includeCounts === true && query.pinned === true;
  if (c === undefined) return true;
  return countBounds(c) && countQuery(c, query) && countRange(page, query, c) && countWitnesses(page, c);
}
type Counts = NonNullable<RunPage['counts']>;
function countBounds(c: Counts): boolean {
  const classified = c.running + c.passed + c.failed + c.cancelled;
  return (
    Number.isSafeInteger(classified) &&
    classified <= c.all &&
    c.pinned <= Math.min(c.all, 256) &&
    c.matched <= c.all &&
    c.before <= c.matched
  );
}
function countQuery(c: Counts, query: NormalizedRunListQuery): boolean {
  if (query.cursor === undefined && c.before !== 0) return false;
  if (query.pinned === true) return c.matched <= c.pinned && chipBounds(c, query);
  if (query.state === undefined && query.outcome === undefined) return c.matched === c.all;
  return chipBounds(c, query);
}
function countRange(page: RunPage, query: NormalizedRunListQuery, c: Counts): boolean {
  const remaining = c.matched - c.before;
  return (
    page.items.length === Math.min(query.limit, remaining) && (page.nextCursor !== null) === remaining > query.limit
  );
}
function countWitnesses(page: RunPage, c: Counts): boolean {
  return (
    page.items.filter((r) => r.state === 'active').length <= c.running &&
    page.items.filter((r) => r.outcome === 'passed').length <= c.passed &&
    page.items.filter((r) => r.outcome === 'failed').length <= c.failed &&
    page.items.filter((r) => r.state === 'cancelled').length <= c.cancelled &&
    page.items.filter((r) => r.pinned === true).length <= c.pinned
  );
}

function chipBounds(c: Counts, query: NormalizedRunListQuery): boolean {
  const caps = chipCounts(c, query);
  if (caps.some((cap) => c.matched > cap)) return false;
  const single = (query.state === undefined) !== (query.outcome === undefined);
  return query.pinned === true || !single || caps.length === 0 || c.matched === caps[0];
}

function chipCounts(c: Counts, query: NormalizedRunListQuery): number[] {
  return [
    query.state === 'active' ? c.running : undefined,
    query.state === 'cancelled' ? c.cancelled : undefined,
    query.outcome === 'passed' ? c.passed : undefined,
    query.outcome === 'failed' ? c.failed : undefined,
  ].filter((value): value is number => value !== undefined);
}
