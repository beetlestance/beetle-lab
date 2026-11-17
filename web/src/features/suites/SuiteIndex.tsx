import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Folder, FolderPage, FolderSummary, Suite, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { Button, buttonClass } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { Table, Td } from '../../components/Table.js';
import { runStatus, StartRun, when } from '../suite-overview/index.js';
import { folderLink, folderName, summaryOf, useFolders } from './folders.js';
import { mixText, plural, searchTerm, useDebounced, WorkspaceTabs } from './listing.js';
import { NewSuite } from './NewSuite.js';
import { SuiteTable } from './SuiteTable.js';

type Order = 'recent_run' | 'name';

/** Suites board: folders with counts and latest run, workspace-wide suite search and sort. */
export function SuiteIndex({ workspace }: { workspace: Workspace }) {
  const folders = useFolders(workspace);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');
  const [order, setOrder] = useState<Order>('recent_run');
  const term = searchTerm(useDebounced(text));
  return (
    <section className="content-section suites-page">
      <header className="suites-header">
        <p className="suites-eyebrow">Workspaces</p>
        <h1>{workspace.name}</h1>
        <p className="suites-lede">
          {folders.data ? `${totals(folders.data, workspace)} ` : ''}Open a folder to filter and run its suites.
        </p>
      </header>
      <div className="suites-toolbar">
        <WorkspaceTabs workspace={workspace} />
        <div className="suites-actions">
          <Link
            className={buttonClass('secondary')}
            to={routes.workspace(workspace.scope.organizationId, workspace.id)}
          >
            New folder
          </Link>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New suite
          </Button>
        </div>
      </div>
      <div className="suites-filters">
        <TextInput
          className="suites-search"
          type="search"
          label={`Search every suite in ${workspace.name}`}
          hideLabel
          placeholder={`Search every suite in ${workspace.name}`}
          maxLength={64}
          value={text}
          onChange={(event) => setText(event.target.value)}
          hint={text.trim().length > 0 && text.trim().length < 3 ? 'Type at least 3 characters.' : undefined}
        />
        <Select label="Sort" hideLabel value={order} onChange={(event) => setOrder(event.target.value as Order)}>
          <option value="recent_run">Recently run</option>
          <option value="name">Name</option>
        </Select>
      </div>
      {term ? (
        <WorkspaceSearch workspace={workspace} term={term} order={order} clear={() => setText('')} />
      ) : (
        <QueryState query={folders} loading={<LoadingState variant="table" label="Loading folders…" />}>
          {(page) => <FolderTable workspace={workspace} page={page} order={order} create={() => setCreating(true)} />}
        </QueryState>
      )}
      {creating && (
        <NewSuite workspace={workspace} folderId={workspace.rootFolderId} close={() => setCreating(false)} />
      )}
    </section>
  );
}
/** "45 suites in 6 folders." only when every folder is on this page. */
function totals(page: FolderPage, workspace: Workspace): string {
  if (page.nextCursor !== null || !page.summaries) return '';
  const suites = page.summaries.reduce((total, summary) => total + summary.suiteCount, 0);
  const folders = page.items.filter(
    (folder) => folder.id.toLowerCase() !== workspace.rootFolderId.toLowerCase(),
  ).length;
  return `${plural(suites, 'suite')} in ${plural(folders, 'folder')}.`;
}
function topLevel(page: FolderPage, workspace: Workspace): Folder[] {
  const root = workspace.rootFolderId.toLowerCase();
  return page.items.filter((folder) => {
    if (folder.id.toLowerCase() === root) return (summaryOf(page, folder.id)?.suiteCount ?? 0) > 0;
    return folder.parentFolderId?.toLowerCase() === root;
  });
}
function FolderTable({
  workspace,
  page,
  order,
  create,
}: {
  workspace: Workspace;
  page: FolderPage;
  order: Order;
  create: () => void;
}) {
  const rows = topLevel(page, workspace);
  const latest = (folder: Folder) => summaryOf(page, folder.id)?.latestRun?.requestedAt ?? '';
  const sorted = [...rows].sort((a, b) =>
    order === 'name'
      ? folderName(a, workspace).localeCompare(folderName(b, workspace))
      : latest(b).localeCompare(latest(a)),
  );
  const names = useLatestSuiteNames(
    workspace,
    sorted.map((folder) => summaryOf(page, folder.id)?.latestRun?.suiteId),
  );
  if (rows.length === 0 && (summaryOf(page, workspace.rootFolderId)?.suiteCount ?? 0) === 0)
    return (
      <EmptyState
        title={`No suites in ${workspace.name} yet`}
        actions={
          <Button variant="primary" onClick={create}>
            Write a suite
          </Button>
        }
        note="A suite saves what to send and how hard. Every run keeps the revision that made it."
      >
        Start with a k6 load test against a service you run.
      </EmptyState>
    );
  return (
    <>
      <Table
        caption="Folders"
        className="folder-table"
        columns={[
          { key: 'folder', label: 'Folder' },
          { key: 'suites', label: 'Suites', numeric: true },
          { key: 'last', label: 'Last run' },
          { key: 'result', label: 'Result' },
        ]}
      >
        {sorted.map((folder) => (
          <FolderRow
            key={folder.id}
            workspace={workspace}
            folder={folder}
            summary={summaryOf(page, folder.id)}
            names={names}
          />
        ))}
      </Table>
      {page.nextCursor !== null && (
        <p className="suites-footnote">Showing the first 100 folders. Search finds suites in every folder.</p>
      )}
    </>
  );
}
function FolderRow({
  workspace,
  folder,
  summary,
  names,
}: {
  workspace: Workspace;
  folder: Folder;
  summary: FolderSummary | undefined;
  names: ReadonlyMap<string, string | undefined>;
}) {
  const run = summary?.latestRun ?? null;
  const name = folderName(folder, workspace);
  return (
    <tr>
      <Td>
        <Link className="suite-name" to={folderLink(workspace, folder.id)}>
          {name}
        </Link>
        {summary && <span className="suite-subline">{mixText(summary)}</span>}
      </Td>
      <Td numeric>{summary ? summary.suiteCount : '—'}</Td>
      <Td>
        {run ? (
          <>
            <span>{names.get(run.suiteId.toLowerCase()) ?? 'A suite in this folder'}</span>
            <time className="suite-subline" dateTime={run.requestedAt}>
              {when(run.requestedAt)}
            </time>
          </>
        ) : (
          <span className="muted">{summary ? 'No runs' : 'Unknown'}</span>
        )}
      </Td>
      <Td>
        {run ? <LatestStatus workspace={workspace} run={run} folderName={name} /> : <span className="muted">—</span>}
      </Td>
    </tr>
  );
}
function LatestStatus({
  workspace,
  run,
  folderName: name,
}: {
  workspace: Workspace;
  run: NonNullable<FolderSummary['latestRun']>;
  folderName: string;
}) {
  const status = runStatus(run);
  return (
    <Link
      to={routes.run(workspace.scope.organizationId, workspace.id, run.runId)}
      aria-label={`${status.label}, latest run in ${name}`}
    >
      <Status tone={status.tone}>{status.label}</Status>
    </Link>
  );
}
/** Names of the suites behind each folder's latest run: one cached read per suite, at most 20. */
function useLatestSuiteNames(workspace: Workspace, ids: (string | undefined)[]) {
  const api = useApi();
  const organizationId = workspace.scope.organizationId;
  const unique = [...new Set(ids.filter((id): id is string => !!id).map((id) => id.toLowerCase()))].slice(0, 20);
  const results = useQueries({
    queries: unique.map((suiteId) => ({
      queryKey: queryKeys.suite(organizationId, workspace.id, suiteId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readResult(api.getSuite({ params: { organizationId, workspaceId: workspace.id, suiteId }, signal })),
    })),
  });
  return new Map(unique.map((id, index) => [id, results[index]?.data?.name]));
}
function WorkspaceSearch({
  workspace,
  term,
  order,
  clear,
}: {
  workspace: Workspace;
  term: string;
  order: Order;
  clear: () => void;
}) {
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const query = { limit: 100, name: term, order };
  const [starting, setStarting] = useState<Suite | null>(null);
  const result = useQuery({
    queryKey: [...queryKeys.suites(params.organizationId, params.workspaceId), 'search', term, order],
    queryFn: ({ signal }) => readResult(api.listSuites({ params, query, signal })),
  });
  return (
    <QueryState query={result} loading={<LoadingState variant="table" label="Searching suites…" />}>
      {(page) =>
        page.items.length === 0 ? (
          <EmptyState
            compact
            title={`No suites in ${workspace.name} match “${term}”`}
            actions={<Button onClick={clear}>Clear search</Button>}
          >
            Search looks at suite names only.
          </EmptyState>
        ) : (
          <>
            <SuiteTable page={page} caption={`Suites matching ${term}`} start={setStarting} />
            <p className="suites-footnote">
              {page.nextCursor
                ? `Showing the first ${page.items.length} matches. Refine the search to see others.`
                : `${plural(page.items.length, 'match', 'matches')}.`}
            </p>
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
        )
      }
    </QueryState>
  );
}
