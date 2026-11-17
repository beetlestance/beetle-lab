import type {
  FolderPage,
  FolderSummary,
  Suite,
  SuiteListQuery,
  SuiteListSummary,
  SuitePage,
} from './generated/types.js';
import type { WorkspaceScope } from './generated/types.js';
import {
  SUITE_GROUPS,
  encodeSuiteListCursor,
  normalizeSuiteListQuery,
  suiteGroupOf,
  suiteListPosition,
} from './suite-list.js';
import type { NormalizedSuiteListQuery, SuiteListPosition } from './suite-list.js';

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
function owns(item: { scope: WorkspaceScope }, owner: WorkspaceScope): boolean {
  return same(item.scope.organizationId, owner.organizationId) && same(item.scope.workspaceId, owner.workspaceId);
}
/** One row's derived facts agree with its suite. */
function factsMatch(item: Suite, summary: SuiteListSummary): boolean {
  const run = summary.latestRun;
  return (
    same(summary.suiteId, item.id) &&
    (run === null || same(run.suiteId, item.id)) &&
    suiteGroupOf(run) === summary.group &&
    (summary.engineId === null) === (item.currentRevisionId === null)
  );
}
/** One row satisfies every query filter. */
function rowMatches(item: Suite, summary: SuiteListSummary, query: NormalizedSuiteListQuery): boolean {
  return (
    factsMatch(item, summary) &&
    (query.folderId === undefined || same(item.folderId, query.folderId)) &&
    (query.group === undefined || summary.group === query.group) &&
    (query.engineId === undefined || summary.engineId === query.engineId)
  );
}
type Key = { requestedAt: string; id: string };
function key(item: Suite, summary: SuiteListSummary): Key {
  return { requestedAt: summary.latestRun?.requestedAt ?? '', id: item.id.toLowerCase() };
}
/** recent_run is strictly descending by (requestedAt, UUID); a missing run sorts last. */
function before(left: Key, right: Key): boolean {
  return left.requestedAt === right.requestedAt ? left.id > right.id : left.requestedAt > right.requestedAt;
}
function ordered(page: SuitePage, query: NormalizedSuiteListQuery, position: SuiteListPosition | null): boolean {
  if (query.order !== 'recent_run' || page.summaries === undefined) return true;
  const summaries = page.summaries;
  let prior: Key | null = position === null ? null : { requestedAt: position.requestedAt ?? '', id: position.id };
  return page.items.every((item, index) => {
    const current = key(item, summaries[index]!);
    const valid = prior === null || before(prior, current);
    prior = current;
    return valid;
  });
}
function continuation(page: SuitePage, owner: WorkspaceScope, query: NormalizedSuiteListQuery): boolean {
  if (page.nextCursor === null) return true;
  const last = page.items.at(-1);
  const summary = page.summaries?.at(-1);
  if (!last || !summary || page.items.length !== query.limit) return false;
  const requestedAt = query.order === 'name' ? null : (summary.latestRun?.requestedAt ?? null);
  return page.nextCursor === encodeSuiteListCursor({ scope: owner, query, requestedAt, id: last.id });
}
/** After schema capture: scope, filters, row facts, recent_run order and exact continuation. */
export function suiteListPageMatches(page: SuitePage, owner: WorkspaceScope, input: SuiteListQuery): boolean {
  try {
    const query = normalizeSuiteListQuery(input);
    const position = suiteListPosition(owner, query);
    if (!owns(page, owner) || page.items.length > query.limit) return false;
    const ids = new Set(page.items.map((item) => item.id.toLowerCase()));
    if (ids.size !== page.items.length || !page.items.every((item) => owns(item, owner))) return false;
    const summaries = page.summaries;
    if (summaries !== undefined) {
      if (summaries.length !== page.items.length) return false;
      if (!page.items.every((item, index) => rowMatches(item, summaries[index]!, query))) return false;
    }
    return ordered(page, query, position) && continuation(page, owner, query);
  } catch {
    return false;
  }
}
function summaryMatches(summary: FolderSummary, id: string): boolean {
  const counts = SUITE_GROUPS.map((group) => summary.groups[group]);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const withRuns = total - summary.groups.no_runs;
  return (
    same(summary.folderId, id) &&
    total === summary.suiteCount &&
    (summary.latestRun === null) === (withRuns === 0) &&
    (summary.latestRun === null || summary.groups[suiteGroupOf(summary.latestRun)] > 0)
  );
}
/** Folder summaries, when present, align with items and classify each direct suite once. */
export function folderPageSummariesMatch(page: FolderPage): boolean {
  const summaries = page.summaries;
  if (summaries === undefined) return true;
  return (
    summaries.length === page.items.length &&
    page.items.every((item, index) => summaryMatches(summaries[index]!, item.id))
  );
}
