import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Suite, SuiteRevision, SuiteRevisionPage, Workspace } from '@beetle/contracts/api';
import { ApiFailure, useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import type { SuiteTab as Tab } from '../../app/routes.js';
import { Button } from '../../components/Button.js';
import { NotFound } from '../../components/NotFound.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { TabPanel, Tabs } from '../../components/Tabs.js';
import { Overview, RecentRuns, StartRun, when } from '../suite-overview/index.js';
import { AuthoringState } from './AuthoringState.js';
import { findFolder, folderLink, folderName, useFolders } from './folders.js';
import { History, useRevisionPage } from './History.js';
import { MetadataEditor } from './MetadataEditor.js';
import { RevisionEditor } from './RevisionEditor.js';
import { useSuitePage } from './useSuitePage.js';

function notFound(query: UseQueryResult<unknown>) {
  return query.error instanceof ApiFailure && query.error.failure.protocol?.code === 'not_found';
}
export function SuiteDetail({ workspace, suiteId }: { workspace: Workspace; suiteId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id, suiteId };
  const key = queryKeys.suite(params.organizationId, params.workspaceId, suiteId);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readResult(api.getSuite({ params, signal })) });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: key });
      client.removeQueries({ queryKey: key });
    },
    [client, suiteId],
  );
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.suites(params.organizationId, params.workspaceId) });
  if (query.data === undefined && notFound(query))
    return (
      <NotFound
        kind="suite"
        back={{ to: routes.suites(params.organizationId, params.workspaceId), label: 'Back to suites' }}
      />
    );
  return (
    <AuthoringState query={query}>
      {(suite) => <SuiteContent suite={suite} workspace={workspace} refresh={refresh} />}
    </AuthoringState>
  );
}
function useTab(): [Tab, (tab: Tab) => void, boolean, (open: boolean) => void] {
  const { page, update } = useSuitePage();
  return [page.tab, (tab) => update({ tab }), page.start, (start) => update({ start })];
}
/** Tabs opened so far; the Edit tab stays mounted once visited so its draft survives tab switches. */
function useVisited(tab: Tab): ReadonlySet<Tab> {
  const [visited, setVisited] = useState(() => new Set<Tab>([tab]));
  useEffect(() => setVisited((seen) => (seen.has(tab) ? seen : new Set([...seen, tab]))), [tab]);
  return visited;
}
function revisionFacts(page: SuiteRevisionPage | undefined) {
  const items = page?.items ?? [];
  return {
    items,
    ordinals: new Map(items.map((item) => [item.id.toLowerCase(), item.ordinal])),
    count: page ? `(${items.length}${page.nextCursor ? '+' : ''})` : undefined,
  };
}
function SuiteContent({
  suite,
  workspace,
  refresh,
}: {
  suite: Suite;
  workspace: Workspace;
  refresh: () => Promise<unknown>;
}) {
  const [tab, setTab, startOpen, setStartOpen] = useTab();
  const [startRevision, setStartRevision] = useState<string | null>(null);
  const visited = useVisited(tab);
  const [details, setDetails] = useState(false);
  const { items, ordinals, count } = revisionFacts(useRevisionPage(suite).data);
  const current = useCurrentRevision(suite);
  const runRevision = startRevision ?? suite.currentRevisionId;
  const openStart = (revisionId: string | null) => {
    setStartRevision(revisionId);
    setStartOpen(true);
  };
  return (
    <section className="content-section suites-page">
      <SuiteHeader suite={suite} workspace={workspace} current={current.data ?? null} start={() => openStart(null)} />
      <Tabs
        label="Suite sections"
        idBase="suite"
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'edit', label: 'Edit' },
          { id: 'revisions', label: 'Revisions', count },
        ]}
        selected={tab}
        onSelect={setTab}
      />
      {tab === 'overview' && (
        <OverviewPanel suite={suite} current={current} ordinals={ordinals} write={() => setTab('edit')} />
      )}
      {visited.has('edit') && (
        <div hidden={tab !== 'edit'}>
          <TabPanel idBase="suite" id="edit">
            <div className="suite-edit-bar">
              <p className="muted">Suite version {suite.version}</p>
              <Button size="sm" onClick={() => setDetails(true)}>
                Edit name, folder and description
              </Button>
            </div>
            <CurrentDraft suite={suite} refresh={refresh} />
          </TabPanel>
        </div>
      )}
      {tab === 'revisions' && (
        <TabPanel idBase="suite" id="revisions">
          <History suite={suite} run={openStart} />
        </TabPanel>
      )}
      {details && <MetadataEditor workspace={workspace} suite={suite} close={() => setDetails(false)} />}
      {startOpen && runRevision && (
        <StartRun
          suite={suite}
          workspaceName={workspace.name}
          revisions={items}
          initialRevisionId={runRevision}
          close={() => {
            setStartOpen(false);
            setStartRevision(null);
          }}
        />
      )}
    </section>
  );
}
function OverviewPanel({
  suite,
  current,
  ordinals,
  write,
}: {
  suite: Suite;
  current: UseQueryResult<SuiteRevision>;
  ordinals: ReadonlyMap<string, number>;
  write: () => void;
}) {
  return (
    <TabPanel idBase="suite" id="overview">
      {!suite.currentRevisionId ? (
        <EmptyState
          title="No saved revision yet"
          actions={
            <Button variant="primary" onClick={write}>
              Write the first revision
            </Button>
          }
        >
          A suite runs only from a saved revision. Save one on the Edit tab.
        </EmptyState>
      ) : (
        <QueryState query={current} loading={<LoadingState variant="cards" label="Loading the current revision…" />}>
          {(revision) => <Overview revision={revision} aside={<RecentRuns suite={suite} ordinals={ordinals} />} />}
        </QueryState>
      )}
    </TabPanel>
  );
}
function SuiteHeader({
  suite,
  workspace,
  current,
  start,
}: {
  suite: Suite;
  workspace: Workspace;
  current: SuiteRevision | null;
  start: () => void;
}) {
  const folders = useFolders(workspace);
  const folder = folders.data ? findFolder(folders.data, suite.folderId) : undefined;
  const org = workspace.scope.organizationId;
  const saved = current
    ? [
        `Revision ${current.ordinal}`,
        current.savedAt ? `saved ${when(current.savedAt)}` : null,
        current.savedBy ? `by ${current.savedBy}` : null,
      ]
        .filter(Boolean)
        .join(', ') + '.'
    : suite.currentRevisionId
      ? null
      : 'No saved revision yet.';
  return (
    <>
      <nav className="suites-crumbs" aria-label="Breadcrumb">
        <Link to={routes.workspace(org, workspace.id)}>{workspace.name}</Link>
        <span aria-hidden="true">/</span>
        <Link to={routes.suites(org, workspace.id)}>Suites</Link>
        {folder && folder.id.toLowerCase() !== workspace.rootFolderId.toLowerCase() && (
          <>
            <span aria-hidden="true">/</span>
            <Link to={folderLink(workspace, folder.id)}>{folderName(folder, workspace)}</Link>
          </>
        )}
      </nav>
      <header className="suite-header">
        <div>
          <h1>{suite.name}</h1>
          <p className="suites-lede">{[suite.description, saved].filter(Boolean).join(' ')}</p>
        </div>
        <Button variant="primary" disabled={!suite.currentRevisionId} onClick={start}>
          Start run
        </Button>
      </header>
    </>
  );
}
function useCurrentRevision(suite: Suite) {
  const api = useApi();
  const client = useQueryClient();
  const params = {
    organizationId: suite.scope.organizationId,
    workspaceId: suite.scope.workspaceId,
    revisionId: suite.currentRevisionId ?? '',
  };
  const key = queryKeys.suiteRevision(params.organizationId, params.workspaceId, params.revisionId);
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: key, type: 'inactive' });
      client.removeQueries({ queryKey: key, type: 'inactive' });
    },
    [client, params.organizationId, params.workspaceId, params.revisionId],
  );
  return useQuery({
    queryKey: key,
    enabled: !!suite.currentRevisionId,
    queryFn: async ({ signal }) => {
      const revision = await readResult(api.getSuiteRevision({ params, signal }));
      if (revision.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return revision;
    },
  });
}
/** The editor takes the revision current when the Edit tab first opens and keeps its draft after that. */
function CurrentDraft({ suite, refresh }: { suite: Suite; refresh: () => Promise<unknown> }) {
  const query = useCurrentRevision(suite);
  const [initial, setInitial] = useState<SuiteRevision | null | undefined>(() =>
    suite.currentRevisionId ? undefined : null,
  );
  useEffect(() => {
    if (initial === undefined && query.data) setInitial(query.data);
  }, [initial, query.data]);
  if (initial !== undefined)
    return <RevisionEditor suite={suite} {...(initial ? { initial } : {})} refresh={refresh} />;
  return <QueryState query={query}>{() => <p role="status">Preparing draft…</p>}</QueryState>;
}
