import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ApiClientFailure,
  CreateFolderRequest,
  Folder,
  PatchFolderRequest,
  Workspace,
} from '@beetle/contracts/api';
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
function useFolderForm(props: Props) {
  const { workspace, folder } = props;
  const [name, setName] = useState(folder?.name ?? '');
  const [parent, setParent] = useState(initialParent(props));
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const { readOnly } = useSessionAccess();
  const { write, refresh } = useFolderWrite(props);
  const issue = folderRefusal(write.failure);
  const parentName =
    parent === workspace.rootFolderId ? workspace.name : (selectedFolder?.name ?? 'The selected parent');
  const nameError =
    issue === 'name'
      ? `${parentName} already has a folder called ${name.trim().normalize('NFKC').toLowerCase()}. Names ignore case.`
      : undefined;
  function changeName(value: string) {
    setName(value);
    if (issue) write.newIntent();
  }
  function changeParent(value: string) {
    setParent(value);
    if (issue) write.newIntent();
  }
  return {
    name,
    parent,
    selectedFolder,
    readOnly,
    write,
    refresh,
    issue,
    nameError,
    changeName,
    changeParent,
    setSelectedFolder,
  };
}

/** Folder mutations stay in Suites, with a bounded named parent picker and receipt-safe retries. */
export function FolderDialog(props: Props) {
  const { workspace, mode, close } = props;
  const {
    name,
    parent,
    selectedFolder,
    readOnly,
    write,
    refresh,
    issue,
    nameError,
    changeName,
    changeParent,
    setSelectedFolder,
  } = useFolderForm(props);
  const title = folderTitle(mode, workspace.name);
  if (issue === 'depth') return <FolderDepthDialog mode={mode} parent={selectedFolder} close={close} />;
  function submit() {
    void write.submit(folderRequest(props, name, parent));
  }
  return (
    <Dialog
      title={title}
      description={issue === 'name' ? undefined : 'Folders group suites. They never change how a run executes.'}
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
            setName={changeName}
            parent={parent}
            setParent={changeParent}
            nameError={nameError}
            onSelected={setSelectedFolder}
            refusal={issue === 'name'}
          />
        </fieldset>
        {mode === 'move' && issue === 'name' && (
          <p className="field-error" role="alert">
            {nameError}
          </p>
        )}
        {!issue && <WriteStatus write={write} refresh={refresh} />}
        <div className="dialog-actions">
          <Button variant="text" disabled={write.pending} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={write.pending}
            loadingLabel="Saving…"
            disabled={write.unknown || readOnly || invalidDraft(mode, name, issue)}
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
function invalidDraft(mode: Props['mode'], name: string, issue: 'name' | 'depth' | undefined): boolean {
  return issue === 'name' || (mode !== 'move' && name.trim().length === 0);
}
function FolderFields({
  workspace,
  mode,
  name,
  setName,
  parent,
  setParent,
  nameError,
  onSelected,
  refusal,
}: {
  workspace: Workspace;
  mode: Props['mode'];
  name: string;
  setName: (name: string) => void;
  parent: string;
  setParent: (id: string) => void;
  nameError: string | undefined;
  onSelected: (folder: Folder | null) => void;
  refusal: boolean;
}) {
  return (
    <>
      {' '}
      {mode !== 'move' && (
        <div className="folder-name-field">
          <TextInput
            label="Name"
            error={nameError}
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
          hint={refusal ? '' : 'Folders nest up to 8 levels.'}
          onSelected={onSelected}
          selected={parent}
          choose={setParent}
        />
      )}
    </>
  );
}

function folderRefusal(failure: ApiClientFailure | null): 'name' | 'depth' | undefined {
  const protocol = failure?.protocol;
  if (
    protocol?.code === 'conflict' &&
    protocol.fields.some((field) => field.path === '/name' && field.code === 'conflict')
  )
    return 'name';
  if (
    protocol?.code === 'invalid_value' &&
    protocol.fields.some((field) => field.path === '/parentFolderId' && field.code === 'range')
  )
    return 'depth';
  return undefined;
}
function FolderDepthDialog({ mode, parent, close }: { mode: Props['mode']; parent: Folder | null; close: () => void }) {
  const detail =
    mode === 'create' && parent?.displayPath.length === 8
      ? `${parent.displayPath.join(' / ')} is already 8 levels deep, the most Beetle allows. Create the folder higher up.`
      : 'This placement would exceed the limit of 8 folder levels, including nested folders. Choose a parent higher up.';
  return (
    <Dialog
      title="Folders can’t go deeper here"
      description={detail}
      onClose={close}
      actions={<Button onClick={close}>Close</Button>}
    />
  );
}
