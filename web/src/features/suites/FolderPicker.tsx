import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Folder, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Button } from '../../components/Button.js';
import { Select } from '../../components/Fields.js';
import { usePage } from '../../components/Pagination.js';

export function FolderPicker({
  workspace,
  selected,
  choose,
  label,
  hint,
  onSelected,
}: {
  workspace: Workspace;
  selected: string;
  choose: (id: string) => void;
  label: string;
  hint: string;
  onSelected?: ((folder: Folder | null) => void) | undefined;
}) {
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const key = queryKeys.folders(params.organizationId, params.workspaceId);
  const page = usePage(key);
  const query = useQuery({
    queryKey: [...key, page.cursor],
    queryFn: ({ signal }) => readResult(api.listFolders({ params, query: page.query, signal })),
  });
  const root = workspace.rootFolderId.toLowerCase();
  const folders = (query.data?.items ?? []).filter((folder) => folder.id.toLowerCase() !== root);
  const selectedFolder = query.isError
    ? undefined
    : folders.find((folder) => folder.id.toLowerCase() === selected.toLowerCase());
  useEffect(() => {
    onSelected?.(selectedFolder ?? null);
  }, [selectedFolder, onSelected]);
  const known = selected.toLowerCase() === root || selectedFolder !== undefined;
  return (
    <div className="suite-folder-select">
      <Select
        label={label}
        value={selected}
        loading={query.isPending}
        error={query.isError ? 'Folder list unavailable. Choices may be out of date.' : undefined}
        hint={hint}
        onChange={(event) => choose(event.target.value)}
      >
        <option value={workspace.rootFolderId}>{workspace.name}</option>
        {!known && <option value={selected}>Current folder</option>}
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.displayPath.join(' / ')}
          </option>
        ))}
      </Select>
      {query.isError && (
        <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
          Retry folders
        </Button>
      )}
      <FolderPages page={page} nextCursor={query.data?.nextCursor} />
    </div>
  );
}

/** Suite metadata uses the same picker with suite-specific copy. */
export function SuiteFolderPicker(props: { workspace: Workspace; selected: string; choose: (id: string) => void }) {
  return (
    <FolderPicker {...props} label="Folder" hint="Folders only group suites. They never change how a run executes." />
  );
}

function FolderPages({
  page,
  nextCursor,
}: {
  page: ReturnType<typeof usePage>;
  nextCursor: string | null | undefined;
}) {
  if (!page.hasBack && !nextCursor) return null;
  return (
    <nav className="pagination" aria-label="Folder pages">
      <Button size="sm" variant="text" disabled={!page.hasBack} onClick={page.back}>
        Previous folders
      </Button>
      <Button
        size="sm"
        variant="text"
        disabled={!nextCursor}
        onClick={() => {
          if (nextCursor) page.next(nextCursor);
        }}
      >
        Next folders
      </Button>
    </nav>
  );
}
