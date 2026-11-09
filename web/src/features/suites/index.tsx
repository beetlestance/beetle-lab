import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Suite, SuiteRevision, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { MetadataEditor } from './MetadataEditor.js';
import { RevisionEditor } from './RevisionEditor.js';
import { History } from './History.js';
import { AuthoringState } from './AuthoringState.js';
import './suites.css';

export function Suites({ organizationId, workspaceId, suiteId }: { organizationId: string; workspaceId: string; suiteId?: string }) {
  const api = useApi();
  const client = useQueryClient();
  const params = { organizationId, workspaceId };
  const key = queryKeys.workspace(organizationId, workspaceId);
  const organization = useQuery({ queryKey: queryKeys.organization(organizationId),
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })) });
  const workspace = useQuery({ queryKey: key, enabled: organization.data !== undefined,
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params, signal })) });
  useEffect(() => () => {
    void client.cancelQueries({ queryKey: key }); client.removeQueries({ queryKey: key });
    void client.cancelQueries({ queryKey: queryKeys.organization(organizationId) });
    client.removeQueries({ queryKey: queryKeys.organization(organizationId) });
  }, [client, organizationId, workspaceId]);
  return <AuthoringState query={organization}>{org => <AuthoringState query={workspace}>{data => <>
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to={routes.organization(org.id)}>{org.name}</Link>
      <Link to={routes.workspace(organizationId, workspaceId)}>{data.name}</Link><Link to={routes.suites(organizationId, workspaceId)}>Suites</Link></nav>
    {suiteId ? <SuiteDetail key={suiteId} workspace={data} suiteId={suiteId} /> : <SuiteIndex workspace={data} />}
  </>}</AuthoringState>}</AuthoringState>;
}
function SuiteIndex({ workspace }: { workspace: Workspace }) {
  const api = useApi(); const client = useQueryClient();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const key = queryKeys.suites(params.organizationId, params.workspaceId);
  const page = usePage(key); const [editing, edit] = useState(false);
  const query = useQuery({ queryKey: [...key, page.cursor], queryFn: ({ signal }) => readResult(api.listSuites({ params, query: page.query, signal })) });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  return <section className="content-section"><header className="section-header"><div><h1>Suites</h1><p>Author configurations and preserve immutable revision history.</p></div>
    <button className="primary" disabled={editing} onClick={() => edit(true)}>Create suite</button></header>
    <QueryState query={query}>{data => <><div className="table-scroll"><table><caption className="sr-only">Suites</caption>
      <thead><tr><th>Suite</th><th>Version</th><th>Current revision</th></tr></thead><tbody>{data.items.map(suite => <tr key={suite.id}>
        <th scope="row"><Link to={routes.suite(params.organizationId, params.workspaceId, suite.id)}>{suite.name}</Link></th>
        <td>{suite.version}</td><td>{suite.currentRevisionId ?? 'No revisions'}</td></tr>)}</tbody></table></div>
      {!data.items.length && <p>No suites yet.</p>}<Pagination page={page} next={data.nextCursor} /></>}</QueryState>
    {editing && <MetadataEditor workspace={workspace} refresh={refresh} close={() => edit(false)} />}
  </section>;
}
function SuiteDetail({ workspace, suiteId }: { workspace: Workspace; suiteId: string }) {
  const api = useApi(); const client = useQueryClient();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id, suiteId };
  const key = queryKeys.suite(params.organizationId, params.workspaceId, suiteId);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readResult(api.getSuite({ params, signal })) });
  useEffect(() => () => { void client.cancelQueries({ queryKey: key }); client.removeQueries({ queryKey: key }); }, [client, suiteId]);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.suites(params.organizationId, params.workspaceId) });
  return <AuthoringState query={query}>{suite => <SuiteContent suite={suite} workspace={workspace} refresh={refresh} />}</AuthoringState>;
}
function SuiteContent({ suite, workspace, refresh }: { suite: Suite; workspace: Workspace; refresh: () => Promise<unknown> }) {
  const [editing, edit] = useState(false);
  return <section className="content-section"><header className="section-header"><div><h1>{suite.name}</h1><p>Suite version {suite.version}</p></div>
    <button onClick={() => edit(true)} disabled={editing}>Edit suite metadata</button></header>
    {editing && <MetadataEditor suite={suite} workspace={workspace} refresh={refresh} close={() => edit(false)} />}
    <CurrentDraft suite={suite} refresh={refresh} /><History suite={suite} />
  </section>;
}
function CurrentDraft({ suite, refresh }: { suite: Suite; refresh: () => Promise<unknown> }) {
  const api = useApi();
  const [initial, setInitial] = useState<SuiteRevision | null | undefined>(() => suite.currentRevisionId ? undefined : null);
  const params = { organizationId: suite.scope.organizationId, workspaceId: suite.scope.workspaceId, revisionId: suite.currentRevisionId ?? '' };
  const query = useQuery({ queryKey: queryKeys.suiteRevision(params.organizationId, params.workspaceId, params.revisionId), enabled: !!suite.currentRevisionId,
    queryFn: async ({ signal }) => {
      const revision = await readResult(api.getSuiteRevision({ params, signal }));
      if (revision.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return revision;
    } });
  const client = useQueryClient();
  useEffect(() => () => {
    const key = queryKeys.suiteRevision(params.organizationId, params.workspaceId, params.revisionId);
    void client.cancelQueries({ queryKey: key, type: 'inactive' }); client.removeQueries({ queryKey: key, type: 'inactive' });
  }, [client, params.organizationId, params.workspaceId, params.revisionId]);
  useEffect(() => { if (initial === undefined && query.data) setInitial(query.data); }, [initial, query.data]);
  if (initial !== undefined) return <RevisionEditor suite={suite} {...(initial ? { initial } : {})} refresh={refresh} />;
  // Once loaded, the editor owns its draft across version refreshes and conflicts.
  return <QueryState query={query}>{() => <p role="status">Preparing draft…</p>}</QueryState>;
}
