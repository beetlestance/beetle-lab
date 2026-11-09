import { lazy, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { WorkspaceList } from './WorkspaceList.js';
import { FolderList } from './FolderList.js';
const WorkspaceInputs = lazy(() => import('../input-screen/index.js').then(module => ({ default: module.WorkspaceInputs })));

export function OrganizationScope({ organizationId, workspaceId, view }: { organizationId: string; workspaceId?: string; view?: 'inputs' }) {
  const api = useApi();
  const client = useQueryClient();
  const key = queryKeys.organization(organizationId);
  const org = useQuery({ queryKey: key,
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })) });
  useEffect(() => () => {
    void client.cancelQueries({ queryKey: queryKeys.organization(organizationId) });
    client.removeQueries({ queryKey: queryKeys.organization(organizationId) });
  }, [client, organizationId]);
  return <QueryState query={org}>{organization => <>
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to={routes.organizations}>Organizations</Link><span aria-hidden="true">/</span>
      <Link to={routes.organization(organizationId)}>{organization.name}</Link>
    </nav>
    <Link to={routes.organizationSettings(organizationId)}>Organization settings</Link>
    <div className="scope-label">Organization <span className="number">{organization.slug}</span></div>
    {workspaceId ? <WorkspaceScope key={workspaceId} organizationId={organizationId} workspaceId={workspaceId} {...(view ? { view } : {})} />
      : <WorkspaceList organizationId={organizationId} />}
  </>}</QueryState>;
}
function WorkspaceScope({ organizationId, workspaceId, view }: { organizationId: string; workspaceId: string; view?: 'inputs' }) {
  const api = useApi();
  const client = useQueryClient();
  const workspace = useQuery({ queryKey: queryKeys.workspace(organizationId, workspaceId),
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params: { organizationId, workspaceId }, signal })) });
  useEffect(() => () => {
    void client.cancelQueries({ queryKey: queryKeys.workspace(organizationId, workspaceId) });
    client.removeQueries({ queryKey: queryKeys.workspace(organizationId, workspaceId) });
  }, [client, organizationId, workspaceId]);
  return <QueryState query={workspace}>{data => <>
    <Link to={routes.workspaceSettings(organizationId, workspaceId)}>Workspace settings</Link>
    <Link to={routes.suites(organizationId, workspaceId)}>Suites</Link>
    <Link to={routes.inputs(organizationId, workspaceId)}>Inputs</Link>
    <p className="workspace-label">Workspace <strong>{data.name}</strong></p>
    {view === 'inputs' ? <WorkspaceInputs workspace={data} /> : <FolderList workspace={data} />}
  </>}</QueryState>;
}
