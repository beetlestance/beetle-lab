import { useEffect, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Pagination, usePage } from '../../components/Pagination.js';

export interface SelectedFolder { readonly id: string; readonly label: string }
export function FolderPicker({ workspace, selected, select, disabled }: {
  workspace: Workspace; selected: SelectedFolder; select: (folder: SelectedFolder) => void; disabled: boolean;
}) {
  const id = useId(); const api = useApi();
  const cache = useQueryClient();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const prefix = [...queryKeys.folders(params.organizationId, params.workspaceId), 'upload', id];
  const identity = JSON.stringify(prefix);
  const page = usePage(prefix);
  const query = useQuery({ queryKey: [...prefix, page.cursor], gcTime: 0, enabled: !disabled,
    queryFn: ({ signal }) => readResult(api.listFolders({ params, query: page.query, signal })) });
  useEffect(() => () => {
    const queryKey = JSON.parse(identity) as string[];
    void cache.cancelQueries({ queryKey });
    cache.removeQueries({ queryKey });
  }, [cache, identity]);
  const items = query.data?.items.filter(folder => folder.id !== workspace.rootFolderId) ?? [];
  const retained = selected.id !== workspace.rootFolderId && !items.some(folder => folder.id === selected.id);
  return <fieldset className="upload-folders" disabled={disabled}>
    <label htmlFor={id}>Destination folder</label>
    <select id={id} value={selected.id} onChange={event => {
      if (event.target.value === selected.id) return;
      const folder = items.find(item => item.id === event.target.value);
      select(folder ? { id: folder.id, label: folder.name } : { id: workspace.rootFolderId, label: 'Workspace root' });
    }}>
      <option value={workspace.rootFolderId}>Workspace root</option>
      {retained && <option value={selected.id}>{selected.label} (selected)</option>}
      {items.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
    </select>
    {query.isPending && <p role="status">Loading folder page…</p>}
    {query.isError && <div className="notice error" role="alert">Folders could not be loaded.
      <button type="button" onClick={() => void query.refetch()}>Retry folder page</button></div>}
    <Pagination page={page} next={query.data?.nextCursor ?? null} />
  </fieldset>;
}
