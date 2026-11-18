import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { Folder, FolderPage, FolderSummary, Suite, Workspace } from '@beetle/contracts/api';
import { useSessionAccess } from '../../app/session.js';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { Table, Td } from '../../components/Table.js';
import { runStatus, StartRun, when } from '../suite-overview/index.js';
import { folderLink, folderName, summaryOf, useFolders } from './folders.js';
import { mixText, plural, searchTerm, useDebounced, WorkspaceTabs } from './listing.js';
import { FolderActions, NewFolderButton } from './FolderActions.js';
import { MetadataEditor } from './MetadataEditor.js';
import { NewSuite } from './NewSuite.js';
import { emptySuiteInventory, SuitesEmpty, SuitesLoading } from './SuiteStates.js';
import { LatestDuration } from './LatestDuration.js';
import { useRunClock } from './useRunClock.js';
import './folder-list.css';
import { SuiteTable } from './SuiteTable.js';

type Order = 'recent_run' | 'name';

/** Suites board: folders with counts and latest run, workspace-wide suite search and sort. */
export function SuiteIndex({ workspace }: { workspace: Workspace }) {
  const folders = useFolders(workspace);
  const [search, setSearch] = useSearchParams();
  const initialView = search.get('new') === 'json' ? 'json' : 'form';
  const [creating, setCreating] = useState(() => ['form', 'json'].includes(search.get('new') ?? ''));
  const closeCreation = () => {
    setCreating(false);
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  };
  const [text, setText] = useState('');
  const [order, setOrder] = useState<Order>('recent_run');
  const term = searchTerm(useDebounced(text));
  const empty = !folders.isError && emptySuiteInventory(folders.data, workspace);
  if (folders.isPending) return <SuitesLoading />;
  return (
    <section className={`content-section suites-page suites-index${empty ? ' suites-page-empty' : ''}`}>
      <SuiteIndexHeader
        workspace={workspace}
        page={folders.isError ? undefined : folders.data}
        empty={empty}
        create={() => setCreating(true)}
      />
      {!empty && (
        <SuiteFilters workspace={workspace} text={text} order={order} chooseText={setText} chooseOrder={setOrder} />
      )}
      {empty ? (
        <SuitesEmpty create={() => setCreating(true)} />
      ) : term ? (
        <WorkspaceSearch workspace={workspace} term={term} order={order} clear={() => setText('')} />
      ) : (
        <QueryState query={folders} loading={<LoadingState variant="table" label="Loading folders…" />}>
          {(page) => <FolderTable workspace={workspace} page={page} order={order} />}
        </QueryState>
      )}
      {creating && (
        <SuiteCreation
          workspace={workspace}
          initialView={initialView}
          fromLink={search.has('new')}
          close={closeCreation}
        />
      )}
    </section>
  );
}
function SuiteCreation({
  workspace,
  initialView,
  fromLink,
  close,
}: {
  workspace: Workspace;
  initialView: 'form' | 'json';
  fromLink: boolean;
  close: () => void;
}) {
  return fromLink ? (
    <MetadataEditor workspace={workspace} initialView={initialView} close={close} />
  ) : (
    <NewSuite workspace={workspace} folderId={workspace.rootFolderId} close={close} />
  );
}
function SuiteIndexHeader({
  workspace,
  page,
  empty,
  create,
}: {
  workspace: Workspace;
  page: FolderPage | undefined;
  empty: boolean;
  create: () => void;
}) {
  const { readOnly } = useSessionAccess();
  return (
    <>
      <header className="suites-header">
        <p className="suites-eyebrow">Workspaces</p>
        <h1>{workspace.name}</h1>
        {!empty && (
          <p className="suites-lede">
            {page ? `${totals(page, workspace)} ` : ''}Open a folder to filter and run its suites.
          </p>
        )}
      </header>
      <div className="suites-toolbar">
        <WorkspaceTabs workspace={workspace} />
        {!empty && (
          <div className="suites-actions">
            <NewFolderButton workspace={workspace} />
            <Button variant="primary" disabled={readOnly} onClick={create}>
              New suite
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
function SuiteFilters({
  workspace,
  text,
  order,
  chooseText,
  chooseOrder,
}: {
  workspace: Workspace;
  text: string;
  order: Order;
  chooseText: (value: string) => void;
  chooseOrder: (value: Order) => void;
}) {
  return (
    <div className="suites-filters">
      <TextInput
        className="suites-search"
        type="search"
        label={`Search every suite in ${workspace.name}`}
        hideLabel
        placeholder={`Search every suite in ${workspace.name}`}
        maxLength={64}
        value={text}
        onChange={(event) => chooseText(event.target.value)}
        hint={text.trim().length > 0 && text.trim().length < 3 ? 'Type at least 3 characters.' : undefined}
      />
      <Select label="Sort" hideLabel value={order} onChange={(event) => chooseOrder(event.target.value as Order)}>
        <option value="recent_run">Recently run</option>
        <option value="name">Name</option>
      </Select>
    </div>
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
function FolderTable({ workspace, page, order }: { workspace: Workspace; page: FolderPage; order: Order }) {
  const rows = topLevel(page, workspace);
  const { restoredBackup } = useSessionAccess();
  const latest = (folder: Folder) => summaryOf(page, folder.id)?.latestRun?.requestedAt ?? '';
  const sorted = [...rows].sort((a, b) =>
    order === 'name'
      ? folderName(a, workspace).localeCompare(folderName(b, workspace))
      : latest(b).localeCompare(latest(a)),
  );
  const now = useRunClock(
    restoredBackup === null &&
      (page.summaries ?? []).some(
        (summary) => summary.latestRun?.state === 'active' && summary.latestRun.startedAt !== null,
      ),
  );
  if (rows.length === 0)
    return (
      <p role="status" className="suites-footnote">
        {page.nextCursor
          ? 'No top-level folders on this page. The inventory is incomplete; search finds suites across the workspace.'
          : 'Folder summaries are unavailable. Suite counts are unknown.'}
      </p>
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
          { key: 'actions', label: <span className="sr-only">Actions</span> },
        ]}
      >
        {sorted.map((folder) => (
          <FolderRow
            key={folder.id}
            workspace={workspace}
            folder={folder}
            summary={summaryOf(page, folder.id)}
            now={now}
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
  now,
}: {
  workspace: Workspace;
  folder: Folder;
  summary: FolderSummary | undefined;
  now: number;
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
            <span>{run.suiteName}</span>
            <time className="suite-subline" dateTime={run.requestedAt}>
              {when(run.requestedAt)}
            </time>
          </>
        ) : (
          <span className="muted">{summary ? 'No runs' : 'Unknown'}</span>
        )}
      </Td>
      <Td>
        {run ? (
          <LatestStatus workspace={workspace} run={run} folderName={name} now={now} />
        ) : (
          <span className="muted">—</span>
        )}
      </Td>
      <Td>
        <FolderActions workspace={workspace} folder={folder} />
      </Td>
    </tr>
  );
}
function LatestStatus({
  workspace,
  run,
  folderName: name,
  now,
}: {
  workspace: Workspace;
  run: NonNullable<FolderSummary['latestRun']>;
  folderName: string;
  now: number;
}) {
  const status = runStatus(run);
  return (
    <div>
      <Link
        to={routes.run(workspace.scope.organizationId, workspace.id, run.runId)}
        aria-label={`${status.label}, latest run in ${name}`}
      >
        <Status tone={status.tone}>{status.label}</Status>
      </Link>
      <LatestDuration run={run} now={now} />
    </div>
  );
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
