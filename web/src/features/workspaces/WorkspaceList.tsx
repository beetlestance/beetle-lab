import { DeleteNamespace } from '../namespace-deletion/index.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import type { Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button, buttonClass } from '../../components/Button.js';
import { useEditor } from '../../components/Editor.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { Table, Td } from '../../components/Table.js';
import { useOrganizationOverview, WorkspaceLastRun, WorkspaceNow } from '../organization-overview/index.js';

const columns = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'now', label: 'Right now' },
  { key: 'last', label: 'Last run' },
  { key: 'actions', label: <span className="sr-only">Actions</span> },
];

type Snapshot = ReturnType<typeof useOrganizationOverview>['data'];
type Edit = (workspace?: Workspace) => void;

/** Create/rename editor plus the refresh shared by edits and deletions. */
function useWorkspaceEditor(organizationId: string) {
  const api = useApi();
  const client = useQueryClient();
  const editor = useEditor();
  const { pathname } = useLocation();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.workspaces(organizationId) }),
      client.invalidateQueries({ queryKey: [...queryKeys.organization(organizationId), 'overview'] }),
    ]);
  const edit: Edit = (workspace) =>
    editor.open({
      title: workspace ? 'Rename workspace' : 'Create workspace',
      path: pathname,
      fields: [{ name: 'name', label: 'Workspace name', value: workspace?.name ?? '' }],
      submit: (values, requestId) => {
        const body = { requestId, scope: { kind: 'organization' as const, organizationId }, name: values.name! };
        return workspace
          ? api.patchWorkspace({
              params: { organizationId, workspaceId: workspace.id },
              body: { ...body, expectedVersion: workspace.version },
            })
          : api.createWorkspace({ params: { organizationId }, body });
      },
      refresh,
    });
  return { busy: editor.busy, edit, refresh };
}

function WorkspaceRows({
  organizationId,
  items,
  snapshot,
  busy,
  edit,
  refresh,
}: {
  organizationId: string;
  items: Workspace[];
  snapshot: Snapshot;
  busy: boolean;
  edit: Edit;
  refresh: () => Promise<unknown>;
}) {
  return (
    <Table caption="Workspaces" columns={columns}>
      {items.map((workspace) => (
        <tr key={workspace.id}>
          <th scope="row">
            <Link to={routes.workspace(organizationId, workspace.id)}>{workspace.name}</Link>
          </th>
          <Td>
            <WorkspaceNow snapshot={snapshot} workspaceId={workspace.id} />
          </Td>
          <Td>
            <WorkspaceLastRun snapshot={snapshot} workspaceId={workspace.id} />
          </Td>
          <Td className="organization-row-actions">
            <Button
              size="sm"
              variant="text"
              disabled={busy}
              aria-label={`Rename ${workspace.name}`}
              onClick={() => edit(workspace)}
            >
              Rename
            </Button>
            <DeleteNamespace target={{ kind: 'workspace', entity: workspace }} refresh={refresh} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/**
 * Penpot "Organization" workspace table (+ Empty, Loading). Per-workspace suite
 * and 24-hour run counts are not in the organization snapshot, so those columns
 * are left out rather than fanned out per row.
 */
export function WorkspaceList({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const api = useApi();
  const editor = useWorkspaceEditor(organizationId);
  const page = usePage(queryKeys.workspaces(organizationId));
  const overview = useOrganizationOverview(organizationId);
  const snapshot = overview.isError ? undefined : overview.data;
  const query = useQuery({
    queryKey: queryKeys.workspacesPage(organizationId, page.cursor),
    queryFn: ({ signal }) => readResult(api.listWorkspaces({ params: { organizationId }, query: page.query, signal })),
  });
  return (
    <section className="organization-workspaces" aria-labelledby="organization-workspaces-heading">
      <header className="overview-section-head">
        <h2 id="organization-workspaces-heading">Workspaces</h2>
        <Button variant="primary" disabled={editor.busy} onClick={() => editor.edit()}>
          Create workspace
        </Button>
      </header>
      <QueryState query={query} loading={<LoadingState variant="table" rows={3} label="Loading workspaces…" />}>
        {(data) =>
          !data.items.length && !page.cursor ? (
            <EmptyState
              compact
              title={`No workspaces in ${organizationName} yet`}
              actions={
                <Link className={buttonClass('secondary', 'sm')} to={routes.organizationSettings(organizationId)}>
                  Organization settings
                </Link>
              }
            >
              A workspace holds one team’s or service’s suites, inputs and runs. Create one to start writing suites.
            </EmptyState>
          ) : (
            <>
              <WorkspaceRows organizationId={organizationId} items={data.items} snapshot={snapshot} {...editor} />
              <Pagination page={page} next={data.nextCursor} />
            </>
          )
        }
      </QueryState>
    </section>
  );
}
