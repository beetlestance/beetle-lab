import { DeleteNamespace } from '../namespace-deletion/index.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import type { Folder, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { useEditor } from '../../components/Editor.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { ResourceTable } from '../../components/ResourceTable.js';

export function FolderList({ workspace }: { workspace: Workspace }) {
  const api = useApi();
  const client = useQueryClient();
  const editor = useEditor();
  const { pathname } = useLocation();
  const { organizationId } = workspace.scope;
  const params = { organizationId, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const key = queryKeys.folders(organizationId, workspace.id);
  const page = usePage(key);
  const query = useQuery({ queryKey: [...key, page.cursor],
    queryFn: ({ signal }) => readResult(api.listFolders({ params, query: page.query, signal })) });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  function edit(folder?: Folder, move = false) {
    const title = folderTitle(folder, move);
    const fields = move ? [] : [{ name: 'name', label: 'Folder name', value: folder?.name ?? '' }];
    if (!folder || move) fields.push({ name: 'parentFolderId', label: 'Parent folder ID', value: folder?.parentFolderId ?? workspace.rootFolderId });
    editor.open({ title, path: pathname,
      fields: fields.map(field => field.name === 'parentFolderId' ? { ...field,
        help: `Enter a folder UUID in this workspace. Workspace root: ${workspace.rootFolderId}. The server checks ancestry and uniqueness.` } : field),
      submit: (values, requestId) => folder
        ? api.patchFolder({ params: { organizationId, id: folder.id }, body: {
          requestId, expectedVersion: folder.version, scope,
          ...(move ? { parentFolderId: values.parentFolderId! } : { name: values.name! }),
        } })
        : api.createFolder({ params, body: { requestId, scope, name: values.name!, parentFolderId: values.parentFolderId! } }),
      refresh });
  }
  return <section className="content-section">
    <header className="section-header"><div><h1>Folders</h1><p>A paged index of folders in {workspace.name}.</p></div>
      <button className="primary" disabled={editor.busy} onClick={() => edit()}>Create folder</button></header>
    <QueryState query={query}>{data => <>
      <ResourceTable title="Folders" headings={['Folder / display path', 'Folder ID', 'Version', 'Actions']} empty={!data.items.length}>
        {data.items.map(folder => <tr key={folder.id}>
          <th scope="row">{folder.name}<small className="display-path">/{folder.displayPath.join('/')}</small></th>
          <td className="number identifier">{folder.id}</td><td className="number">{folder.version}</td>
          <td><div className="actions"><button disabled={editor.busy} aria-label={`Rename ${folder.name}`} onClick={() => edit(folder)}>Rename</button>
            <button disabled={editor.busy || folder.id === workspace.rootFolderId} aria-label={`Move ${folder.name}`} onClick={() => edit(folder, true)}>Move</button><DeleteNamespace target={{kind: 'folder', entity: folder}} refresh={refresh} disabled={folder.id === workspace.rootFolderId} /></div></td>
        </tr>)}
      </ResourceTable><Pagination page={page} next={data.nextCursor} />
    </>}</QueryState>
  </section>;
}

function folderTitle(folder: Folder | undefined, move: boolean) {
  if (!folder) return 'Create folder';
  return move ? 'Move folder' : 'Rename folder';
}
