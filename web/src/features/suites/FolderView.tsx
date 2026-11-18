import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { FolderSummary, Suite, SuiteGroup, SuiteListQuery, Workspace } from '@beetle/contracts/api';
import { useSessionAccess } from '../../app/session.js';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { NotFound } from '../../components/NotFound.js';
import { usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import { LoadingState } from '../../components/States.js';
import { groupText, StartRun } from '../suite-overview/index.js';
import { childrenOf, findFolder, folderLink, folderName, summaryOf, useFolders } from './folders.js';
import { plural, searchTerm, useDebounced, WorkspaceTabs } from './listing.js';
import { FolderActions, NewFolderButton } from './FolderActions.js';
import { NewSuite } from './NewSuite.js';
import { SuiteTable } from './SuiteTable.js';
import { FolderEmpty } from './SuiteStates.js';
import './folder-view.css';

const FIRST = 8;
const MORE = 12;
const MAX_WINDOW = 100;
type Filters = { group: SuiteGroup | 'all'; engine: 'all' | 'k6'; order: 'recent_run' | 'name'; text: string };
const initial: Filters = { group: 'all', engine: 'all', order: 'recent_run', text: '' };

/** Suites / Folder: one folder's suites with status, engine, name and order filters, a bounded expandable window. */
export function FolderView({ workspace, folderId }: { workspace: Workspace; folderId: string }) {
  const folders = useFolders(workspace);
  const { readOnly } = useSessionAccess();
  const [creating, setCreating] = useState(false);
  return (
    <QueryState query={folders} loading={<LoadingState variant="page" label="Loading folder…" />}>
      {(page) => {
        const folder = findFolder(page, folderId);
        if (!folder && page.nextCursor === null)
          return (
            <NotFound
              kind="page"
              reason="That folder isn't in this workspace."
              back={{ to: routes.suites(workspace.scope.organizationId, workspace.id), label: 'Back to suites' }}
            />
          );
        const name = folder ? folderName(folder, workspace) : 'Folder';
        const summary = summaryOf(page, folderId);
        const children = childrenOf(page, folderId);
        const empty = summary?.suiteCount === 0;
        return (
          <section className={`content-section suites-page suites-folder${empty ? ' suites-page-empty' : ''}`}>
            <nav className="suites-crumbs" aria-label="Breadcrumb">
              <Link to={routes.workspace(workspace.scope.organizationId, workspace.id)}>{workspace.name}</Link>
              <span aria-hidden="true">/</span>
              <Link to={routes.suites(workspace.scope.organizationId, workspace.id)}>Suites</Link>
            </nav>
            <FolderHeading name={name} summary={summary} empty={empty} />
            <div className="suites-toolbar">
              <WorkspaceTabs workspace={workspace} />
              <div className="suites-actions">
                <NewFolderButton workspace={workspace} parentFolderId={folderId} />
                <FolderActions workspace={workspace} folder={folder} />
                {!empty && (
                  <Button variant="primary" disabled={readOnly} onClick={() => setCreating(true)}>
                    New suite
                  </Button>
                )}
              </div>
            </div>
            {children.length > 0 && (
              <nav className="folder-children" aria-label="Subfolders">
                <span className="muted">Subfolders</span>
                {children.map((child) => (
                  <Link key={child.id} to={folderLink(workspace, child.id)}>
                    {child.name}
                  </Link>
                ))}
              </nav>
            )}
            {empty ? (
              <FolderEmpty name={name} create={() => setCreating(true)} />
            ) : (
              <FolderSuites key={folderId} workspace={workspace} folderId={folderId} name={name} summary={summary} />
            )}
            {creating && <NewSuite workspace={workspace} folderId={folderId} close={() => setCreating(false)} />}
          </section>
        );
      }}
    </QueryState>
  );
}
function FolderHeading({ name, summary, empty }: { name: string; summary: FolderSummary | undefined; empty: boolean }) {
  return (
    <header className="suites-header">
      <h1>{name}</h1>
      {!empty && (
        <p className="suites-lede">
          {summary && `${plural(summary.suiteCount, 'suite')}. `}Runs always use the revision that made them.
        </p>
      )}
    </header>
  );
}
function chips(summary: FolderSummary | undefined, selected: Filters['group']) {
  const groups = Object.keys(groupText) as SuiteGroup[];
  const all = { value: 'all' as const, label: 'All', count: summary?.suiteCount };
  const shown = groups.filter((group) => !summary || summary.groups[group] > 0 || group === selected);
  return [
    all,
    ...shown.map((group) => ({ value: group, label: groupText[group].label, count: summary?.groups[group] })),
  ];
}
function listQuery(folderId: string, filters: Filters, term: string | undefined, limit: number): SuiteListQuery {
  return {
    limit,
    folderId,
    order: filters.order,
    ...(filters.group === 'all' ? {} : { group: filters.group }),
    ...(filters.engine === 'all' ? {} : { engineId: filters.engine }),
    ...(term ? { name: term } : {}),
  };
}
/** One server-filtered page of a folder's suites; the page cursor resets when any filter changes. */
function useFolderSuites(workspace: Workspace, folderId: string, filters: Filters, term: string | undefined) {
  const [limit, setLimit] = useState(FIRST);
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const query = listQuery(folderId, filters, term, limit);
  const prefix = [
    ...queryKeys.suites(params.organizationId, params.workspaceId),
    'folder',
    folderId.toLowerCase(),
    filters.group,
    filters.engine,
    filters.order,
    term ?? '',
    String(limit),
  ];
  const page = usePage(prefix);
  const result = useQuery({
    queryKey: [...prefix, page.cursor],
    queryFn: ({ signal }) =>
      readResult(
        api.listSuites({ params, query: { ...query, ...(page.cursor ? { cursor: page.cursor } : {}) }, signal }),
      ),
  });
  return {
    page,
    result,
    limit,
    expand: () => {
      page.reset();
      setLimit(Math.min(MAX_WINDOW, limit + MORE));
    },
    reset: () => {
      page.reset();
      setLimit(FIRST);
    },
  };
}
function FolderSuites({
  workspace,
  folderId,
  name,
  summary,
}: {
  workspace: Workspace;
  folderId: string;
  name: string;
  summary: FolderSummary | undefined;
}) {
  const [filters, setFilters] = useState(initial);
  const [starting, setStarting] = useState<Suite | null>(null);
  const term = searchTerm(useDebounced(filters.text));
  const { page, result, limit, expand, reset } = useFolderSuites(workspace, folderId, filters, term);
  const change = (next: Partial<Filters>) => {
    reset();
    setFilters({ ...filters, ...next });
  };
  const total =
    filters.engine !== 'all' || term
      ? undefined
      : filters.group === 'all'
        ? summary?.suiteCount
        : summary?.groups[filters.group];
  return (
    <>
      <FolderFilters name={name} summary={summary} filters={filters} change={change} />
      <QueryState query={result} loading={<LoadingState variant="table" label="Loading suites…" />}>
        {(data) =>
          data.items.length === 0 ? (
            <NoMatch name={name} term={term} clear={() => change(term ? { text: '' } : { ...initial })} />
          ) : (
            <>
              <SuiteTable page={data} caption={`Suites in ${name}`} start={setStarting} />
              <Pager
                shown={data.items.length}
                total={term ? undefined : total}
                order={filters.order}
                limit={limit}
                expand={!page.hasBack && limit < MAX_WINDOW && data.nextCursor ? expand : null}
                back={page.hasBack ? page.back : null}
                next={data.nextCursor ? () => data.nextCursor && page.next(data.nextCursor) : null}
              />
            </>
          )
        }
      </QueryState>
      {starting?.currentRevisionId && (
        <StartRun
          suite={starting}
          workspaceName={workspace.name}
          revisions={[]}
          initialRevisionId={starting.currentRevisionId}
          close={() => setStarting(null)}
        />
      )}
    </>
  );
}
function FolderFilters({
  name,
  summary,
  filters,
  change,
}: {
  name: string;
  summary: FolderSummary | undefined;
  filters: Filters;
  change: (next: Partial<Filters>) => void;
}) {
  const typed = filters.text.trim().length;
  return (
    <div className="suites-filters folder-filters">
      <SegmentedFilter
        label="Last run result"
        options={chips(summary, filters.group)}
        value={filters.group}
        onChange={(group) => change({ group })}
      />
      <Select
        label="Engine"
        hideLabel
        value={filters.engine}
        onChange={(event) => change({ engine: event.target.value === 'k6' ? 'k6' : 'all' })}
      >
        <option value="all">All engines</option>
        <option value="k6">k6 load</option>
      </Select>
      <TextInput
        className="suites-search"
        type="search"
        label={`Search suites in ${name}`}
        hideLabel
        placeholder={`Search suites in ${name}`}
        maxLength={64}
        value={filters.text}
        onChange={(event) => change({ text: event.target.value })}
        hint={typed > 0 && typed < 3 ? 'Type at least 3 characters.' : undefined}
      />
      <Select
        label="Sort"
        hideLabel
        value={filters.order}
        onChange={(event) => change({ order: event.target.value === 'name' ? 'name' : 'recent_run' })}
      >
        <option value="recent_run">Recently run</option>
        <option value="name">Name</option>
      </Select>
    </div>
  );
}
function NoMatch({ name, term, clear }: { name: string; term: string | undefined; clear: () => void }) {
  return (
    <section className="folder-no-match" role="status">
      <p>
        {term
          ? `No suites in ${name} match “${term}”. Search looks at suite names only.`
          : `No suites in ${name} match these filters. Change the result or engine filter to see other suites.`}
      </p>
      <Button size="sm" onClick={clear}>
        {term ? 'Clear search' : 'Clear filters'}
      </Button>
    </section>
  );
}

function Pager({
  shown,
  total,
  order,
  limit,
  expand,
  back,
  next,
}: {
  shown: number;
  total: number | undefined;
  order: Filters['order'];
  limit: number;
  expand: (() => void) | null;
  back: (() => void) | null;
  next: (() => void) | null;
}) {
  return (
    <nav className="suites-pager" aria-label="Suite pages">
      <span className="muted">
        {total !== undefined ? `Showing ${shown} of ${plural(total, 'suite')}` : `Showing ${plural(shown, 'suite')}`}
        {order === 'recent_run' ? ', most recently run first' : ', by name'}
      </span>
      {back && (
        <Button size="sm" onClick={back}>
          Previous {limit}
        </Button>
      )}
      {next && (
        <Button size="sm" onClick={expand ?? next}>
          {expand
            ? total !== undefined && total > shown
              ? `Show ${Math.min(MORE, total - shown)} more`
              : 'Show more'
            : `Next ${limit}`}
        </Button>
      )}
    </nav>
  );
}
