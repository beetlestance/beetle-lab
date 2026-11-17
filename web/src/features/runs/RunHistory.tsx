import { validateApi } from '@beetle/contracts/api';
import type { RunPage } from '@beetle/contracts/api';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button, buttonClass } from '../../components/Button.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { HistoryFilters, filtersActive } from './HistoryFilters.js';
import type { HistoryFilter } from './HistoryFilters.js';
import { HistoryTable } from './HistoryTable.js';
import { useSuiteNames } from './HistorySuites.js';
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
  const suiteName = suiteId ? suites.name(suiteId) : undefined;
  return (
    <div className="history">
      <header className="history-header">
        <div>
          <h1>Runs</h1>
          {suiteId ? (
            <p className="history-lede">
              History for {suiteName ?? <span className="number">suite {suiteId.slice(0, 8)}</span>}.{' '}
              <Link to={routes.runs(scope.organizationId, scope.workspaceId)}>Every suite</Link>
            </p>
          ) : (
            <p className="history-lede">Every run in this workspace. Start a run from a suite.</p>
          )}
        </div>
      </header>
      <HistoryFilters
        applied={context.filters}
        apply={apply}
        suites={suites.suites}
        suiteLocked={suiteId !== undefined}
      />
      <HistoryPage
        key={context.epoch}
        scope={scope}
        filters={context.filters}
        reset={() => apply({ order: 'newest' })}
        name={suites.name}
      />
    </div>
  );
}
function HistoryPage({
  scope,
  filters,
  reset,
  name,
}: {
  scope: RunScope;
  filters: HistoryFilter;
  reset(): void;
  name(suiteId: string): string | undefined;
}) {
  const { selected, setSelected, toggle, query, page, refresh } = useHistoryPage(scope, filters);
  const filtered = filtersActive(filters);
  return (
    <>
      <HistoryToolbar
        scope={scope}
        selected={selected}
        clear={() => setSelected([])}
        refresh={refresh}
        fetching={query.isFetching}
      />
      <QueryState query={query} loading={<LoadingState variant="table" label="Loading runs…" rows={6} />}>
        {(data: RunPage) =>
          data.items.length === 0 && !page.hasBack ? (
            <HistoryEmpty scope={scope} filtered={filtered} reset={reset} />
          ) : (
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
              {(page.hasBack || data.nextCursor) && (
                <Pagination page={page} next={data.nextCursor} order={filters.order ?? 'newest'} label="Run pages" />
              )}
            </>
          )
        }
      </QueryState>
    </>
  );
}
function HistoryToolbar({
  scope,
  selected,
  clear,
  refresh,
  fetching,
}: {
  scope: RunScope;
  selected: readonly string[];
  clear(): void;
  refresh(): void;
  fetching: boolean;
}) {
  return (
    <div className="history-toolbar">
      <p className="history-compare-hint" aria-live="polite">
        {selected.length === 0
          ? 'Tick two to four finished runs to compare them. The first you tick is the baseline.'
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
function HistoryEmpty({ scope, filtered, reset }: { scope: RunScope; filtered: boolean; reset(): void }) {
  if (filtered)
    return (
      <EmptyState
        compact
        title="No runs match these filters"
        actions={
          <Button size="sm" onClick={reset}>
            Reset filters
          </Button>
        }
      >
        Search matches suite, folder and workspace names, run notes, or the start of a run ID.
      </EmptyState>
    );
  return (
    <EmptyState
      title="No runs yet"
      actions={
        <Link className={buttonClass('primary')} to={routes.suites(scope.organizationId, scope.workspaceId)}>
          Open suites
        </Link>
      }
    >
      Runs appear here when you start one from a saved suite revision.
    </EmptyState>
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
  const applied = { ...page.query, ...filters };
  const query = useQuery({
    // The unfiltered first page is the exact key command search and the overview share.
    queryKey: queryKeys.runsPage(scope.organizationId, scope.workspaceId, page.cursor, applied),
    queryFn: ({ signal }) => readResult(api.listRuns({ params: scope, query: applied, signal })),
  });
  function refresh() {
    if (page.cursor) page.reset();
    else void query.refetch();
  }
  return { selected, setSelected, toggle, query, page, refresh };
}
