import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Folder, Workspace } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
import { useSessionAccess } from '../../app/session.js';
import { Button } from '../../components/Button.js';
import { DeleteNamespace } from '../namespace-deletion/index.js';
import { FolderDialog } from './FolderDialog.js';

export function NewFolderButton({ workspace, parentFolderId }: { workspace: Workspace; parentFolderId?: string }) {
  const [open, setOpen] = useState(false);
  const { readOnly } = useSessionAccess();
  return (
    <>
      <Button disabled={readOnly} onClick={() => setOpen(true)}>
        New folder
      </Button>
      {open && (
        <FolderDialog
          mode="create"
          workspace={workspace}
          {...(parentFolderId ? { parentFolderId } : {})}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
/** Native disclosure keeps keyboard access without inventing an ARIA menu interaction model. */
export function FolderActions({ workspace, folder }: { workspace: Workspace; folder: Folder | undefined }) {
  const [mode, setMode] = useState<'rename' | 'move' | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const client = useQueryClient();
  const { readOnly } = useSessionAccess();
  if (!folder || folder.id.toLowerCase() === workspace.rootFolderId.toLowerCase()) return null;
  function edit(next: 'rename' | 'move') {
    summary.current?.focus();
    if (details.current) details.current.open = false;
    setMode(next);
  }
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.workspace(workspace.scope.organizationId, workspace.id) });
  return (
    <>
      <details className="folder-row-actions" ref={details}>
        <summary ref={summary} aria-label={`Actions for ${folder.name}`}>
          ⋯
        </summary>
        <div className="folder-action-list">
          <Button
            variant="text"
            disabled={readOnly}
            onClick={() => edit('rename')}
            aria-label={`Rename ${folder.name}`}
          >
            Rename
          </Button>
          <Button variant="text" disabled={readOnly} onClick={() => edit('move')} aria-label={`Move ${folder.name}`}>
            Move
          </Button>
          <DeleteNamespace target={{ kind: 'folder', entity: folder }} refresh={refresh} disabled={readOnly} />
        </div>
      </details>
      {mode && <FolderDialog mode={mode} folder={folder} workspace={workspace} close={() => setMode(null)} />}
    </>
  );
}
