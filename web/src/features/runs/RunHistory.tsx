import { validateApi } from '@beetle/contracts/api';
import type { RunPage } from '@beetle/contracts/api';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { isConnectionFailure, readResult, useApi } from '../../app/api.js';
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

type HistoryPageProps = {
  scope: RunScope;
  filters: HistoryFilter;
  reset(): void;
  controls: {
    suites: ReturnType<typeof useSuiteNames>;
    suiteId: string | undefined;
    apply(value: HistoryFilter): void;
  };
};

function HistoryPage({ scope, filters, reset, controls }: HistoryPageProps) {
  const { selected, setSelected, toggle, query, page, refresh } = useHistoryPage(scope, filters);
  const { filtered, stale, current, empty } = historyView(query, filters, controls.suiteId, page.hasBack);
  return (
    <div className="history">
      <HistoryIntro scope={scope} controls={controls} current={current} pending={query.isPending} />
      {stale && (
        <p className="history-stale" role="status">
          Showing runs from {formatHistoryTime(query.dataUpdatedAt)}. Run actions are paused until refresh succeeds.
        </p>
      )}
      {!empty && (
        <HistoryFilters
          disabled={stale}
          applied={filters}
          counts={current?.counts}
          apply={controls.apply}
          suites={controls.suites.suites}
          suiteLocked={controls.suiteId !== undefined}
          compare={<HistoryCompare scope={scope} selected={selected} disabled={stale} />}
        />
      )}
      <HistoryResults
        scope={scope}
        state={{ query, page, selected, toggle }}
        controls={{ reset, name: controls.suites.name, filtered, stale, order: filters.order ?? 'newest' }}
      />
      {(!empty || stale) && (
        <HistoryToolbar
          selected={selected}
          clear={() => setSelected([])}
          refresh={refresh}
          fetching={query.isFetching}
          counted={current?.counts !== undefined}
        />
      )}
    </div>
  );
}

function historyView(
  query: ReturnType<typeof useHistoryPage>['query'],
  filters: HistoryFilter,
  suiteId: string | undefined,
  hasBack: boolean,
) {
  // A suite context from the address is not a filter the reader chose, so it never makes the page look filtered.
  const filtered = filtersActive(suiteId ? withoutSuite(filters) : filters);
  const stale = query.isRefetchError && isConnectionFailure(query.error);
  const current = stale || query.isSuccess ? query.data : undefined;
  const empty = current?.items.length === 0 && !hasBack && !filtered;
  return { filtered, stale, current, empty };
}

function HistoryIntro({
  scope,
  controls,
  current,
  pending,
}: {
  scope: RunScope;
  controls: HistoryPageProps['controls'];
  current: RunPage | undefined;
  pending: boolean;
}) {
  return (
    <div className="history-intro">
      <HistoryHeader
        scope={scope}
        workspaceName={current?.workspaceName}
        pending={pending}
        counts={current?.counts}
        countsUnavailable={current?.countsUnavailable}
        suiteId={controls.suiteId}
        suiteName={controls.suiteId ? controls.suites.name(controls.suiteId) : undefined}
      />
      <WorkspaceTabs organizationId={scope.organizationId} workspaceId={scope.workspaceId} current="runs" />
    </div>
  );
}

function HistoryResults({
  scope,
  state,
  controls,
}: {
  scope: RunScope;
  state: Pick<ReturnType<typeof useHistoryPage>, 'query' | 'page' | 'selected' | 'toggle'>;
  controls: {
    reset(): void;
    name(suiteId: string): string | undefined;
    filtered: boolean;
    stale: boolean;
    order: 'newest' | 'oldest';
  };
}) {
  const { query, page, selected, toggle } = state;
  const { reset, name, filtered, stale, order } = controls;
  return (
    <QueryState query={query} loading={<HistoryLoading />} retainOnDisconnect>
      {(data: RunPage) =>
        data.items.length === 0 && !page.hasBack ? (
          <HistoryEmpty scope={scope} filtered={filtered} reset={reset} disabled={stale} />
        ) : (
          <HistoryRows
            scope={scope}
            data={data}
            selected={selected}
            toggle={toggle}
            name={name}
            filtered={filtered}
            stale={stale}
            page={page}
            order={order}
          />
        )
      }
    </QueryState>
  );
}

function HistoryLoading() {
  return (
    <div className="history-loading">
      <div className="history-loading-labels" aria-hidden="true">
        <span>Result</span>
        <span>Suite</span>
        <span>Started</span>
        <span>p95</span>
      </div>
      <LoadingState variant="table" label="Loading runs…" rows={9} />
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
  stale,
  page,
  order,
}: {
  scope: RunScope;
  data: RunPage;
  selected: readonly string[];
  toggle(id: string): void;
  name(id: string): string | undefined;
  filtered: boolean;
  stale: boolean;
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
        stale={stale}
        caption={filtered ? 'Matching runs' : 'Workspace runs'}
      />
      {data.items.length === 0 && <p className="history-cell-note">No more runs.</p>}
      {(page.hasBack || data.nextCursor || data.counts) && (
        <Pagination
          disabled={stale}
          page={page}
          next={data.nextCursor}
          order={order}
          label="Run pages"
          summary={historyRange(data)}
        />
      )}
    </>
  );
}

function HistoryCompare({
  scope,
  selected,
  disabled,
}: {
  scope: RunScope;
  selected: readonly string[];
  disabled: boolean;
}) {
  if (disabled || selected.length < 2)
    return (
      <Button variant="primary" disabled>
        Compare
      </Button>
    );
  return (
    <Link
      className={buttonClass('primary')}
      to={routes.comparison(scope.organizationId, scope.workspaceId, [...selected])}
    >
      Compare {selected.length}
    </Link>
  );
}

function HistoryToolbar({
  selected,
  clear,
  refresh,
  fetching,
  counted,
}: {
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
    if (page.cursor && !query.isRefetchError) page.reset();
    else void query.refetch();
  }
  return { selected, setSelected, toggle, query, page, refresh };
}

const historyClock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function formatHistoryTime(updatedAt: number): string {
  return historyClock.format(updatedAt);
}

function withoutSuite(filters: HistoryFilter): HistoryFilter {
  const copy = { ...filters };
  delete copy.suiteId;
  return copy;
}
