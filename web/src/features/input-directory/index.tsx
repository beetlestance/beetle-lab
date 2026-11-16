import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiClient, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { useApi, useInputTransfers } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { FolderPicker } from '../input-upload/FolderPicker.js';
import { UploadRecoveryActions } from '../input-upload/recovery.js';
import { inputScopeKey } from '../input-upload/scope.js';
import { DirectoryWorkflow } from './workflow.js';
import type { DirectoryState } from './workflow.js';
import { DirectoryError, planDirectory } from './plan.js';
import type { DirectoryPlan } from './plan.js';

export function DirectoryInput({workspace}: {workspace: Workspace}) {
  const api = useApi(); const transfers = useInputTransfers();
  if (!transfers) return null;
  return <DirectoryScope key={inputScopeKey(workspace, api, transfers)} workspace={workspace} api={api} transfers={transfers} />;
}
function DirectoryScope({workspace, api, transfers}: {workspace: Workspace; api: ApiClient; transfers: InputTransferClient}) {
  const [generation, setGeneration] = useState(0);
  return <DirectoryDraft key={generation} workspace={workspace} api={api} transfers={transfers} clear={() => setGeneration(value => value + 1)} />;
}
function DirectoryDraft({workspace, api, transfers, clear}: {
  workspace: Workspace; api: ApiClient; transfers: InputTransferClient; clear: () => void;
}) {
  const cache = useQueryClient(); const id = useId();
  const [initialWorkspace] = useState(workspace);
  const [plan, setPlan] = useState<DirectoryPlan>(); const [error, setError] = useState('');
  const [destination, selectDestination] = useState({id: workspace.rootFolderId, label: 'Workspace root'});
  const [state, setState] = useState<DirectoryState>({busy: false, retained: false, message: '', rows: [], complete: false});
  const owner = useRef<DirectoryWorkflow | null>(null);
  useEffect(() => {
    const workflow = new DirectoryWorkflow({api, transfers, workspace: initialWorkspace, changed: setState,
      invalidate: () => {
        void cache.invalidateQueries({queryKey: queryKeys.inputs(initialWorkspace.scope.organizationId, initialWorkspace.id)});
        void cache.invalidateQueries({queryKey: queryKeys.folders(initialWorkspace.scope.organizationId, initialWorkspace.id)});
      }});
    owner.current = workflow;
    return () => {workflow.dispose(); owner.current = null;};
  }, [api, transfers, initialWorkspace, cache]);
  function select(files: FileList | null) {
    setPlan(undefined); setError('');
    try {if (files?.length) setPlan(planDirectory(files));}
    catch (cause) {setError(cause instanceof DirectoryError ? cause.message : 'Directory selection could not be read.');}
  }
  return <section className="input-upload content-section" aria-label="Import directory">
    <header><h2>Import directory</h2><p>Preserve the selected directory and nested folders. Up to 128 files, 8 MiB each and 128 MiB total; eight folder levels including the destination.</p></header>
    <label htmlFor={id}>Input directory</label>
    <input id={id} type="file" multiple disabled={state.retained} ref={element => {element?.setAttribute('webkitdirectory', '');}}
      onChange={event => select(event.target.files)} />
    <p>Only folders containing selected files are imported. Imports are sequential and are not atomic; cancellation or clearing a draft can leave folders or partial inputs.</p>
    <FolderPicker workspace={workspace} selected={destination} select={selectDestination} disabled={state.retained} />
    {error && <p role="alert">{error}</p>}
    {plan && <p>{plan.files.length} files, {plan.folders} folders, {plan.bytes} bytes selected.</p>}
    {!state.retained && plan && <button onClick={() => {void owner.current?.start(plan, destination.id);}}>Import directory</button>}
    <DirectoryProgress state={state} />
    <DirectoryActions state={state} owner={owner.current} clear={clear} />
  </section>;
}

function DirectoryActions({state, owner, clear}: {state: DirectoryState; owner: DirectoryWorkflow | null; clear: () => void}) {
  if (state.busy) return <button onClick={() => owner?.cancel()}>Cancel directory import</button>;
  if (!state.retained) return null;
  if (state.complete) return <button onClick={clear}>Clear completed directory draft</button>;
  return <>
    {state.current ? <>
      <UploadRecoveryActions state={state.current} run={action => {void owner?.run(action);}} />
      <button onClick={() => {void owner?.skip();}}>Skip current file (partial input may remain)</button>
    </> : <button onClick={() => {void owner?.run();}}>Retry directory import</button>}
    <button onClick={clear}>Discard directory draft</button>
  </>;
}

function DirectoryProgress({state}: {state: DirectoryState}) {
  return <div aria-live="polite">
    {state.message && <p role="status">{state.message}</p>}
    {state.current?.message && <p>{state.current.message}</p>}
    {state.rows.length > 0 && <ul>{state.rows.map(row => <li key={row.path}>{row.path}: {row.status}</li>)}</ul>}
  </div>;
}
