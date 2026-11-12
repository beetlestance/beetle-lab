import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import type { Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { useEditor } from '../../components/Editor.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { ResourceTable } from '../../components/ResourceTable.js';

export function WorkspaceList({ organizationId }: { organizationId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const editor = useEditor();
  const { pathname } = useLocation();
  const page = usePage(queryKeys.workspaces(organizationId));
  const query = useQuery({ queryKey: queryKeys.workspacesPage(organizationId,page.cursor),
    queryFn: ({ signal }) => readResult(api.listWorkspaces({ params: { organizationId }, query: page.query, signal })) });
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.workspaces(organizationId) });
  function edit(workspace?: Workspace) {
    editor.open({ title: workspace ? 'Rename workspace' : 'Create workspace', path: pathname,
      fields: [{ name: 'name', label: 'Workspace name', value: workspace?.name ?? '' }],
      submit: (values, requestId) => {
        const body = { requestId, scope: { kind: 'organization' as const, organizationId }, name: values.name! };
        return workspace ? api.patchWorkspace({ params: { organizationId, workspaceId: workspace.id }, body: { ...body, expectedVersion: workspace.version } })
          : api.createWorkspace({ params: { organizationId }, body });
      }, refresh });
  }
  return <section className="content-section">
    <header className="section-header"><div><h1>Workspaces</h1><p>Projects and services in this organization.</p></div>
      <button className="primary" disabled={editor.busy} onClick={() => edit()}>Create workspace</button></header>
    <QueryState query={query}>{data => <>
      <ResourceTable title="Workspaces" headings={['Workspace', 'Version', 'Actions']} empty={!data.items.length}>
        {data.items.map(workspace => <tr key={workspace.id}>
          <th scope="row"><Link to={routes.workspace(organizationId, workspace.id)}>{workspace.name}</Link></th>
          <td className="number">{workspace.version}</td><td><button disabled={editor.busy} aria-label={`Rename ${workspace.name}`} onClick={() => edit(workspace)}>Rename</button></td>
        </tr>)}
      </ResourceTable><Pagination page={page} next={data.nextCursor} />
    </>}</QueryState>
  </section>;
}
