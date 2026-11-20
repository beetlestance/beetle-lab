import { OrganizationOverview } from '../organization-overview/index.js';
import { WorkspaceOverview } from '../workspace-overview/index.js';
import { lazy, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiFailure, useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { NotFound } from '../../components/NotFound.js';
import type { NotFoundKind } from '../../components/NotFound.js';
import { QueryState } from '../../components/QueryState.js';
import { LoadingState } from '../../components/States.js';
import { WorkspaceHeading } from '../../app/shell/WorkspaceHeading.js';
import { WorkspaceTabs } from '../../app/shell/WorkspaceTabs.js';
import { WorkspaceExports } from '../exports/ExportsTable.js';
import { WorkspaceList } from './WorkspaceList.js';
const Settings = lazy(() => import('../settings/index.js').then((module) => ({ default: module.Settings })));
const WorkspaceInputs = lazy(() =>
  import('../input-screen/index.js').then((module) => ({ default: module.WorkspaceInputs })),
);

export type WorkspaceView = 'inputs' | 'exports' | 'settings';

/** A missing scope is not found, never an empty dashboard. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiFailure && (error.failure.protocol?.code === 'not_found' || error.failure.status === 404);
}

function ScopeState<T>({
  query,
  kind,
  back,
  loading,
  children,
}: {
  query: UseQueryResult<T>;
  kind: NotFoundKind;
  back: { to: string; label: string };
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isError && isNotFound(query.error)) return <NotFound kind={kind} back={back} />;
  return (
    <QueryState query={query} loading={loading}>
      {children}
    </QueryState>
  );
}

export function OrganizationScope({
  organizationId,
  workspaceId,
  view,
  directory = false,
}: {
  organizationId: string;
  workspaceId?: string;
  directory?: boolean;
  view?: WorkspaceView | undefined;
}) {
  const api = useApi();
  const client = useQueryClient();
  const key = queryKeys.organization(organizationId);
  const org = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: queryKeys.organization(organizationId) });
      client.removeQueries({ queryKey: queryKeys.organization(organizationId) });
    },
    [client, organizationId],
  );
  return (
    <ScopeState
      query={org}
      kind="organization"
      back={{ to: routes.organizations, label: 'Back to overview' }}
      loading={<LoadingState variant="page" label="Loading organization…" />}
    >
      {(organization) =>
        workspaceId ? (
          <WorkspaceScope
            key={workspaceId}
            organizationId={organizationId}
            workspaceId={workspaceId}
            {...(view ? { view } : {})}
          />
        ) : (
          <>
            {directory ? (
              <header className="section-header">
                <div>
                  <p className="eyebrow">{organization.name}</p>
                  <h1>Workspaces</h1>
                </div>
              </header>
            ) : (
              <OrganizationOverview key={organizationId} organization={organization} />
            )}
            <WorkspaceList
              organizationId={organizationId}
              organizationName={organization.name}
              showHeading={!directory}
            />
          </>
        )
      }
    </ScopeState>
  );
}
function WorkspaceScope({
  organizationId,
  workspaceId,
  view,
}: {
  organizationId: string;
  workspaceId: string;
  view?: WorkspaceView | undefined;
}) {
  const api = useApi();
  const client = useQueryClient();
  const workspace = useQuery({
    queryKey: queryKeys.workspace(organizationId, workspaceId),
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params: { organizationId, workspaceId }, signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: queryKeys.workspace(organizationId, workspaceId) });
      client.removeQueries({ queryKey: queryKeys.workspace(organizationId, workspaceId) });
    },
    [client, organizationId, workspaceId],
  );
  return (
    <ScopeState
      query={workspace}
      kind="workspace"
      back={{ to: routes.organizationWorkspaces(organizationId), label: 'Back to workspaces' }}
      loading={<LoadingState variant="page" label="Loading workspace…" />}
    >
      {(data) => (
        <div className="workspace-page">
          {view && <WorkspaceHeading name={data.name} />}
          <WorkspaceTabs organizationId={organizationId} workspaceId={workspaceId} current={view ?? 'overview'} />
          {view === 'exports' ? (
            <WorkspaceExports organizationId={organizationId} workspaceId={workspaceId} />
          ) : view === 'inputs' ? (
            <WorkspaceInputs workspace={data} />
          ) : view === 'settings' ? (
            <Settings scope={{ kind: 'workspace', organizationId, workspaceId }} />
          ) : (
            <>
              <WorkspaceOverview organizationId={organizationId} workspaceId={workspaceId} workspaceName={data.name} />
            </>
          )}
        </div>
      )}
    </ScopeState>
  );
}
