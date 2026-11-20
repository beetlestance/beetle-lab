import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InputRecord, Workspace } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Status } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import { Table, Td } from '../../components/Table.js';
import { addedDate, formatBytes, inputStatus, plural, shapeText } from './format.js';

const columns = [
  { key: 'file', label: 'File' },
  { key: 'status', label: 'Status' },
  { key: 'used', label: 'Used by', numeric: true },
  { key: 'size', label: 'Size', numeric: true },
  { key: 'added', label: 'Added' },
  { key: 'actions', label: <span className="sr-only">Actions</span> },
] as const;

/**
 * Inventory rows. Folder names come from one bounded folder page, read only when a
 * listed input sits outside the workspace root; unnamed folders stay unlabelled.
 */
export function InputTable({
  workspace,
  items,
  selected,
  select,
  filterFolders,
}: {
  workspace: Workspace;
  items: readonly InputRecord[];
  selected: string | null;
  select: (id: string) => void;
  /** Folder filtering is offered only when the whole inventory is on this page. */
  filterFolders: boolean;
}) {
  const names = useFolderNames(workspace, items);
  const [folder, setFolder] = useState('all');
  const folderIds = [...new Set(items.map((item) => item.folderId))];
  const visible = folder === 'all' ? items : items.filter((item) => item.folderId === folder);
  return (
    <>
      {filterFolders && folderIds.length > 1 && (
        <SegmentedFilter
          className="inputs-filter"
          label="Folder"
          value={folderIds.includes(folder) ? folder : 'all'}
          onChange={setFolder}
          options={[
            { value: 'all', label: 'All folders', count: items.length },
            ...folderIds.map((id) => ({
              value: id,
              label: names.get(id) ?? 'Unnamed folder',
              count: items.filter((item) => item.folderId === id).length,
            })),
          ]}
        />
      )}
      <Table caption="Workspace inputs" columns={columns} className="inputs-table" scrollLabel="Input files">
        {visible.map((input) => {
          const status = inputStatus(input);
          const meta = [names.get(input.folderId), shapeText(input)].filter(Boolean).join(' · ');
          return (
            <tr key={input.id} aria-selected={selected === input.id || undefined}>
              <th scope="row">
                <span className="input-name">{input.name}</span>
                {meta && <span className="input-meta">{meta}</span>}
              </th>
              <Td>
                <Status tone={status.tone}>{status.label}</Status>
              </Td>
              <Td numeric muted={!input.usedByCount}>
                {usedBy(input)}
              </Td>
              <Td numeric>{formatBytes(input.bytes)}</Td>
              <Td muted>{addedDate(input)}</Td>
              <Td className="input-row-actions">
                <Button
                  size="sm"
                  variant="text"
                  disabled={selected !== null}
                  onClick={() => select(input.id)}
                  aria-label={`Read current status for ${input.name}`}
                >
                  Details
                </Button>
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}

function usedBy(input: InputRecord): string | undefined {
  if (input.usedByCount === undefined) return undefined;
  return input.usedByCount === 0 ? 'Not used' : plural(input.usedByCount, 'revision');
}

function useFolderNames(workspace: Workspace, items: readonly InputRecord[]): ReadonlyMap<string, string> {
  const api = useApi();
  const organizationId = workspace.scope.organizationId;
  const needed = items.some((item) => item.folderId !== workspace.rootFolderId);
  const query = useQuery({
    queryKey: [...queryKeys.folders(organizationId, workspace.id), 'input-names'],
    enabled: needed,
    queryFn: ({ signal }) =>
      readResult(
        api.listFolders({ params: { organizationId, workspaceId: workspace.id }, query: { limit: 100 }, signal }),
      ),
  });
  const names = new Map<string, string>([[workspace.rootFolderId, 'Workspace root']]);
  for (const folder of query.data?.items ?? []) names.set(folder.id, folder.displayPath.join(' / ') || folder.name);
  return names;
}
