import { validateApi } from '@beetle/contracts/api';
import type { RunPage } from '@beetle/contracts/api';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { WorkspaceTabs } from '../../app/shell/WorkspaceTabs.js';
import { routes } from '../../app/routes.js';
import { Button, buttonClass } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { LoadingState } from '../../components/States.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { HistoryFilters, filtersActive } from './HistoryFilters.js';
import type { HistoryFilter } from './HistoryFilters.js';
import { HistoryTable } from './HistoryTable.js';
import { useSuiteNames } from './HistorySuites.js';
import { HistoryHeader } from './HistoryHeader.js';
import { historyRange } from './history-range.js';
import { HistoryEmpty } from './HistoryEmpty.js';
import type { RunScope } from './types.js';
import './history.css';

export function RunHistory(scope: RunScope) {
  const { search } = useLocation();
  if (search.length > 2048) return <p role="alert">Invalid history context.</p>;
  const query = new URLSearchParams(search);
  const ids = query.getAll('suiteId');
  const pinned = query.get('pinned') === 'true';
  if (ids.length > 1 || (ids.length === 1 && !validateApi('Uuid', ids[0]).ok))
    return <p role="alert">Invalid suite history context.</p>;
  const suiteId = ids[0]?.toLowerCase();
  return (
    <HistoryContext
      key={JSON.stringify([scope, suiteId, pinned])}
      scope={scope}
      pinned={pinned}
      {...(suiteId ? { suiteId } : {})}
    />
  );
}
function HistoryContext({ scope, suiteId, pinned }: { scope: RunScope; suiteId?: string; pinned: boolean }) {
  const [context, setContext] = useState({
    filters: { order: 'newest', ...(suiteId ? { suiteId } : {}), ...(pinned ? { pinned: true } : {}) } as HistoryFilter,
    epoch: 0,
  });
  const suites = useSuiteNames(scope);
  function apply(filters: HistoryFilter) {
    setContext((previous) => ({ filters: { ...filters, ...(suiteId ? { suiteId } : {}) }, epoch: previous.epoch + 1 }));
  }
  return (
    <HistoryPage
      key={context.epoch}
      scope={scope}
      filters={context.filters}
      reset={() => apply({ order: 'newest' })}
      controls={{ suites, suiteId, apply }}
    />
  );
}

function HistoryPage({
  scope,
  filters,
  reset,
  controls,
}: {
  scope: RunScope;
  filters: HistoryFilter;
  reset(): void;
  controls: {
    suites: ReturnType<typeof useSuiteNames>;
    suiteId: string | undefined;
    apply(value: HistoryFilter): void;
  };
}) {
  const { selected, setSelected, toggle, query, page, refresh } = useHistoryPage(scope, filters);
  const filtered = filtersActive(filters);
  const current = currentHistoryPage(query);
  const empty = query.isSuccess && query.data.items.length === 0 && !page.hasBack && !filtered;
  return (
    <div className="history">
      <div className="history-intro">
        <HistoryHeader
          scope={scope}
          workspaceName={current.workspaceName}
          pending={query.isPending}
          counts={current.counts}
          countsUnavailable={current.countsUnavailable}
          suiteId={controls.suiteId}
          suiteName={controls.suiteId ? controls.suites.name(controls.suiteId) : undefined}
        />
        <WorkspaceTabs organizationId={scope.organizationId} workspaceId={scope.workspaceId} current="runs" />
      </div>
      {!empty && (
        <>
          <HistoryFilters
            applied={filters}
            counts={current.counts}
            apply={controls.apply}
            suites={controls.suites.suites}
            suiteLocked={controls.suiteId !== undefined}
          />
          <HistoryToolbar
            scope={scope}
            selected={selected}
            clear={() => setSelected([])}
            refresh={refresh}
            fetching={query.isFetching}
            counted={current.counts !== undefined}
          />
        </>
      )}
      <QueryState query={query} loading={<LoadingState variant="table" label="Loading runs…" rows={6} />}>
        {(data: RunPage) =>
          data.items.length === 0 && !page.hasBack ? (
            <HistoryEmpty scope={scope} filtered={filtered} reset={reset} />
          ) : (
            <HistoryRows
              scope={scope}
              data={data}
              selected={selected}
              toggle={toggle}
              name={controls.suites.name}
              filtered={filtered}
              page={page}
              order={filters.order ?? 'newest'}
            />
          )
        }
      </QueryState>
    </div>
  );
}

function HistoryRows({
  scope,
  data,
  selected,
  toggle,
  name,
  filtered,
  page,
  order,
}: {
  scope: RunScope;
  data: RunPage;
  selected: readonly string[];
  toggle(id: string): void;
  name(id: string): string | undefined;
  filtered: boolean;
  page: ReturnType<typeof usePage>;
  order: 'newest' | 'oldest';
}) {
  return (
    <>
      <HistoryTable
        scope={scope}
        page={data}
        selected={selected}
        toggle={toggle}
        name={name}
        caption={filtered ? 'Matching runs' : 'Workspace runs'}
      />
      {data.items.length === 0 && <p className="history-cell-note">No more runs.</p>}
      {(page.hasBack || data.nextCursor || data.counts) && (
        <Pagination page={page} next={data.nextCursor} order={order} label="Run pages" summary={historyRange(data)} />
      )}
    </>
  );
}

function HistoryToolbar({
  scope,
  selected,
  clear,
  refresh,
  fetching,
  counted,
}: {
  scope: RunScope;
  selected: readonly string[];
  clear(): void;
  refresh(): void;
  fetching: boolean;
  counted: boolean;
}) {
  return (
    <div className="history-toolbar">
      <p className="history-compare-hint" aria-live="polite">
        {selected.length === 0
          ? counted
            ? ''
            : 'Tick two to four finished runs to compare them. The first you tick is the baseline.'
          : `${selected.length} selected. The first is the baseline.`}
      </p>
      <div className="history-toolbar-actions">
        {selected.length > 0 && (
          <Button variant="text" size="sm" onClick={clear}>
            Clear selection
          </Button>
        )}
        {selected.length >= 2 ? (
          <Link
            className={buttonClass('primary', 'sm')}
            to={routes.comparison(scope.organizationId, scope.workspaceId, [...selected])}
          >
            Compare {selected.length}
          </Link>
        ) : (
          <Button variant="primary" size="sm" disabled>
            Compare
          </Button>
        )}
        <Button size="sm" onClick={refresh} disabled={fetching}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

function useHistoryPage(scope: RunScope, filters: HistoryFilter) {
  const api = useApi();
  const owner = useMemo(() => ({}), [api, scope.organizationId, scope.workspaceId]);
  const [selection, setSelection] = useState({ owner, ids: [] as string[] });
  const selected = selection.owner === owner ? selection.ids : [];
  function setSelected(value: string[] | ((previous: string[]) => string[])) {
    setSelection({ owner, ids: typeof value === 'function' ? value(selected) : value });
  }
  function toggle(id: string) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length < 4
          ? [...previous, id]
          : previous,
    );
  }
  const key = queryKeys.runs(scope.organizationId, scope.workspaceId);
  const page = usePage(key);
  const applied = { ...page.query, ...filters, includeCounts: true as const };
  const query = useQuery({
    // Enriched history pages cannot reuse an uncounted overview/search page.
    queryKey: queryKeys.runsPage(scope.organizationId, scope.workspaceId, page.cursor, applied),
    queryFn: ({ signal }) => readResult(api.listRuns({ params: scope, query: applied, signal })),
  });
  function refresh() {
    if (page.cursor) page.reset();
    else void query.refetch();
  }
  return { selected, setSelected, toggle, query, page, refresh };
}

function currentHistoryPage(query: {
  isError: boolean;
  data: RunPage | undefined;
}): Pick<RunPage, 'workspaceName' | 'counts' | 'countsUnavailable'> {
  return query.isError ? {} : (query.data ?? {});
}
