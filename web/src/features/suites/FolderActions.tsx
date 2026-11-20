import { useEffect, useId, useRef, useState } from 'react';
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
/** Native popovers escape table clipping and retain browser light-dismiss and Escape behavior. */
export function FolderActions({ workspace, folder }: { workspace: Workspace; folder: Folder | undefined }) {
  const [mode, setMode] = useState<'rename' | 'move' | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (menu.current && trigger.current) positionActions(menu.current, trigger.current);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  const client = useQueryClient();
  const { readOnly } = useSessionAccess();
  if (!folder || folder.id.toLowerCase() === workspace.rootFolderId.toLowerCase()) return null;
  function closeMenu() {
    trigger.current?.focus();
    menu.current?.hidePopover();
  }
  function edit(next: 'rename' | 'move') {
    closeMenu();
    setMode(next);
  }
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.workspace(workspace.scope.organizationId, workspace.id) });
  return (
    <>
      <div className="folder-row-actions">
        <button ref={trigger} popoverTarget={menuId} aria-label={`Actions for ${folder.name}`}>
          ⋯
        </button>
        <div
          id={menuId}
          ref={menu}
          popover="auto"
          className="folder-action-list"
          onToggle={(event) => {
            const visible = event.newState === 'open';
            setOpen(visible);
            if (visible && trigger.current) positionActions(event.currentTarget, trigger.current);
          }}
        >
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
          <DeleteNamespace
            target={{ kind: 'folder', entity: folder }}
            refresh={refresh}
            disabled={readOnly}
            onOpen={closeMenu}
          />
        </div>
      </div>
      {mode && <FolderDialog mode={mode} folder={folder} workspace={workspace} close={() => setMode(null)} />}
    </>
  );
}

/** Clamp the top-layer panel to the viewport rather than its scrollable table cell. */
function positionActions(panel: HTMLDivElement, trigger: HTMLButtonElement): void {
  const anchor = trigger.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const below = anchor.bottom + 4;
  const top = below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 4;
  panel.style.top = `${Math.max(8, top)}px`;
  panel.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
}
