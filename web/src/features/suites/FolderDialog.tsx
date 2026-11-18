import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateFolderRequest, Folder, PatchFolderRequest, Workspace } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { useSessionAccess } from '../../app/session.js';
import { queryKeys } from '../../app/queries.js';
import { Button } from '../../components/Button.js';
import { useToast } from '../../components/Toast.js';
import { Dialog } from '../../components/Dialog.js';
import { TextInput } from '../../components/Fields.js';
import { FolderPicker } from './FolderPicker.js';
import { useWrite, WriteStatus } from './useWrite.js';
import './folder-dialog.css';

type Props = { workspace: Workspace; close: () => void } & (
  { mode: 'create'; folder?: never; parentFolderId?: string } | { mode: 'rename' | 'move'; folder: Folder }
);
type Request = CreateFolderRequest | PatchFolderRequest;
function useFolderWrite({ workspace, folder, close }: Props) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.workspace(params.organizationId, workspace.id) });
  };
  const write = useWrite<Request>(
    async (body, signal) => {
      if ('expectedVersion' in body) {
        if (!folder) throw new Error('A folder revision is required');
        return api.patchFolder({ params: { organizationId: params.organizationId, id: folder.id }, body, signal });
      }
      return api.createFolder({ params, body, signal });
    },
    async () => {
      await refresh();
      toast.show('Folder saved.');
      close();
    },
  );
  return { write, refresh };
}
/** Folder mutations stay in Suites, with a bounded named parent picker and receipt-safe retries. */
export function FolderDialog(props: Props) {
  const { workspace, folder, mode, close } = props;
  const [name, setName] = useState(folder?.name ?? '');
  const [parent, setParent] = useState(initialParent(props));
  const { readOnly } = useSessionAccess();
  const { write, refresh } = useFolderWrite(props);
  const title = folderTitle(mode, workspace.name);
  function submit() {
    void write.submit(folderRequest(props, name, parent));
  }
  return (
    <Dialog
      title={title}
      description="Folders group suites. They never change how a run executes."
      onClose={close}
      dismissible={!write.pending}
    >
      <form
        className="folder-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={write.locked || readOnly}>
          <legend className="sr-only">Folder details</legend>
          <FolderFields
            workspace={workspace}
            mode={mode}
            name={name}
            setName={setName}
            parent={parent}
            setParent={setParent}
          />
        </fieldset>
        <WriteStatus write={write} refresh={refresh} />
        <div className="dialog-actions">
          <Button variant="text" disabled={write.pending} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={write.pending}
            loadingLabel="Saving…"
            disabled={write.unknown || readOnly || invalidName(mode, name)}
          >
            {mode === 'create' ? 'Create folder' : 'Save folder'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function folderRequest({ workspace, folder, mode }: Props, name: string, parent: string): Request {
  const scope = {
    kind: 'workspace' as const,
    organizationId: workspace.scope.organizationId,
    workspaceId: workspace.id,
  };
  const common = { scope, requestId: crypto.randomUUID() };
  if (!folder) return { ...common, name: name.trim(), parentFolderId: parent };
  return {
    ...common,
    expectedVersion: folder.version,
    ...(mode === 'move' ? { parentFolderId: parent } : { name: name.trim() }),
  };
}

function initialParent(props: Props): string {
  return (
    props.folder?.parentFolderId ??
    ('parentFolderId' in props ? props.parentFolderId : undefined) ??
    props.workspace.rootFolderId
  );
}
function folderTitle(mode: Props['mode'], workspaceName: string): string {
  if (mode === 'create') return `New folder in ${workspaceName}`;
  return mode === 'move' ? 'Move folder' : 'Rename folder';
}
function invalidName(mode: Props['mode'], name: string): boolean {
  return mode !== 'move' && name.trim().length === 0;
}
function FolderFields({
  workspace,
  mode,
  name,
  setName,
  parent,
  setParent,
}: {
  workspace: Workspace;
  mode: Props['mode'];
  name: string;
  setName: (name: string) => void;
  parent: string;
  setParent: (id: string) => void;
}) {
  return (
    <>
      {' '}
      {mode !== 'move' && (
        <div className="folder-name-field">
          <TextInput
            label="Name"
            required
            maxLength={128}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="folder-name-count" aria-hidden="true">
            {Array.from(name).length} / 128
          </span>
        </div>
      )}
      {mode !== 'rename' && (
        <FolderPicker
          workspace={workspace}
          label="Inside"
          hint="Folders nest up to 8 levels."
          selected={parent}
          choose={setParent}
        />
      )}
    </>
  );
}
