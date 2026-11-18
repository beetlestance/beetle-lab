import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { FolderSummary, Suite, SuiteGroup, SuiteListQuery, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { NotFound } from '../../components/NotFound.js';
import { usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { groupText, StartRun } from '../suite-overview/index.js';
import { childrenOf, findFolder, folderLink, folderName, summaryOf, useFolders } from './folders.js';
import { plural, searchTerm, useDebounced, WorkspaceTabs } from './listing.js';
import { FolderActions, NewFolderButton } from './FolderActions.js';
import { NewSuite } from './NewSuite.js';
import { SuiteTable } from './SuiteTable.js';

const PAGE = 20;
type Filters = { group: SuiteGroup | 'all'; engine: 'all' | 'k6'; order: 'recent_run' | 'name'; text: string };
const initial: Filters = { group: 'all', engine: 'all', order: 'recent_run', text: '' };

/** Suites / Folder: one folder's suites with status, engine, name and order filters, 20 per page. */
export function FolderView({ workspace, folderId }: { workspace: Workspace; folderId: string }) {
  const folders = useFolders(workspace);
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
        return (
          <section className="content-section suites-page">
            <nav className="suites-crumbs" aria-label="Breadcrumb">
              <Link to={routes.workspace(workspace.scope.organizationId, workspace.id)}>{workspace.name}</Link>
              <span aria-hidden="true">/</span>
              <Link to={routes.suites(workspace.scope.organizationId, workspace.id)}>Suites</Link>
            </nav>
            <header className="suites-header">
              <h1>{name}</h1>
              <p className="suites-lede">
                {summary ? (summary.suiteCount ? `${plural(summary.suiteCount, 'suite')}. ` : 'No suites yet. ') : ''}
                Runs always use the revision that made them.
              </p>
            </header>
            <div className="suites-toolbar">
              <WorkspaceTabs workspace={workspace} />
              <div className="suites-actions">
                <NewFolderButton workspace={workspace} parentFolderId={folderId} />
                <FolderActions workspace={workspace} folder={folder} />
                <Button variant="primary" onClick={() => setCreating(true)}>
                  New suite
                </Button>
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
            {summary?.suiteCount === 0 ? (
              <EmptyState
                title={`No suites in ${name} yet`}
                actions={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New suite in {name}
                  </Button>
                }
                note="Folders only group suites. They never change how a run executes."
              >
                Add a suite here to keep it with the others for this service. Inputs stay shared across the whole
                workspace, so any suite can use them.
              </EmptyState>
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
function chips(summary: FolderSummary | undefined, selected: Filters['group']) {
  const groups = Object.keys(groupText) as SuiteGroup[];
  const all = { value: 'all' as const, label: 'All', count: summary?.suiteCount };
  const shown = groups.filter((group) => !summary || summary.groups[group] > 0 || group === selected);
  return [
    all,
    ...shown.map((group) => ({ value: group, label: groupText[group].label, count: summary?.groups[group] })),
  ];
}
function listQuery(folderId: string, filters: Filters, term: string | undefined): SuiteListQuery {
  return {
    limit: PAGE,
    folderId,
    order: filters.order,
    ...(filters.group === 'all' ? {} : { group: filters.group }),
    ...(filters.engine === 'all' ? {} : { engineId: filters.engine }),
    ...(term ? { name: term } : {}),
  };
}
/** One server-filtered page of a folder's suites; the page cursor resets when any filter changes. */
function useFolderSuites(workspace: Workspace, folderId: string, filters: Filters, term: string | undefined) {
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const query = listQuery(folderId, filters, term);
  const prefix = [
    ...queryKeys.suites(params.organizationId, params.workspaceId),
    'folder',
    folderId.toLowerCase(),
    filters.group,
    filters.engine,
    filters.order,
    term ?? '',
  ];
  const page = usePage(prefix);
  const result = useQuery({
    queryKey: [...prefix, page.cursor],
    queryFn: ({ signal }) =>
      readResult(
        api.listSuites({ params, query: { ...query, ...(page.cursor ? { cursor: page.cursor } : {}) }, signal }),
      ),
  });
  return { page, result };
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
  const { page, result } = useFolderSuites(workspace, folderId, filters, term);
  const change = (next: Partial<Filters>) => {
    page.reset();
    setFilters({ ...filters, ...next });
  };
  const total = filters.group === 'all' ? summary?.suiteCount : summary?.groups[filters.group];
  return (
    <>
      <FolderFilters name={name} summary={summary} filters={filters} change={change} />
      <QueryState query={result} loading={<LoadingState variant="table" label="Loading suites…" />}>
        {(data) =>
          data.items.length === 0 ? (
            <NoMatch name={name} term={term} clear={() => change({ ...initial })} />
          ) : (
            <>
              <SuiteTable page={data} caption={`Suites in ${name}`} start={setStarting} />
              <Pager
                shown={data.items.length}
                total={term ? undefined : total}
                order={filters.order}
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
    <EmptyState
      compact
      title={term ? `No suites in ${name} match “${term}”` : `No suites in ${name} match these filters`}
      actions={<Button onClick={clear}>{term ? 'Clear search' : 'Clear filters'}</Button>}
    >
      {term ? 'Search looks at suite names only.' : 'Change the result or engine filter to see other suites.'}
    </EmptyState>
  );
}
function Pager({
  shown,
  total,
  order,
  back,
  next,
}: {
  shown: number;
  total: number | undefined;
  order: Filters['order'];
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
          Previous {PAGE}
        </Button>
      )}
      {next && (
        <Button size="sm" onClick={next}>
          Next {PAGE}
        </Button>
      )}
    </nav>
  );
}
