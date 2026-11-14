import { inputScopeKey } from './scope.js';
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiClient, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { useApi, useInputTransfers } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { FolderPicker } from './FolderPicker.js';
import { UploadWorkflow } from './workflow.js';
import type { UploadState } from './workflow.js';
import { UploadRecoveryActions } from './recovery.js';
import './upload.css';

/** Prepared bytes and request identities retire with their workspace or client. */
export function UploadInput({ workspace }: { workspace: Workspace }) {
  const api = useApi();
  const transfers = useInputTransfers();
  if (!transfers) return <section className="notice" aria-label="Upload input">
    <h2>Upload input</h2><p>Input transfer is unavailable for this session.</p>
    <button disabled>Upload input</button>
  </section>;
  const identity = inputScopeKey(workspace, api, transfers);
  return <UploadScope key={identity} workspace={workspace} api={api} transfers={transfers} />;
}

function UploadScope({ workspace, api, transfers }: {
  workspace: Workspace; api: ApiClient; transfers: InputTransferClient;
}) {
  const cache = useQueryClient();
  const formId = useId();
  const [initialWorkspace] = useState(workspace);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [folder, selectFolder] = useState({ id: workspace.rootFolderId, label: 'Workspace root' });
  const [state, setState] = useState<UploadState>({ phase: 'idle', busy: false, retained: false, message: '' });
  const [generation, setGeneration] = useState(0);
  const workflow = useRef<UploadWorkflow | null>(null);
  useEffect(() => {
    const owner = new UploadWorkflow({ api, transfers, workspace: initialWorkspace, changed: setState,
      invalidate: () => { void cache.invalidateQueries({ queryKey: queryKeys.inputs(initialWorkspace.scope.organizationId, initialWorkspace.id) }); } });
    workflow.current = owner;
    return () => { owner.dispose(); workflow.current = null; };
  }, [api, transfers, initialWorkspace, cache]);
  function discard() {
    workflow.current?.discard();
    setFile(undefined); setName(''); setGeneration(value => value + 1);
  }
  return <section className="input-upload content-section" aria-label="Upload input">
    <header><h2>Upload input</h2><p>Choose one file up to 8 MiB. The draft stays in memory and retires when you leave this workspace or session.</p></header>
    <form id={formId} onSubmit={event => { event.preventDefault(); if (file) workflow.current?.start(file, name, folder.id); }}>
      <fieldset className="upload-fields" disabled={state.retained}>
        <label htmlFor="upload-file">Input file</label>
        <input key={generation} id="upload-file" type="file" onChange={event => setFile(event.target.files?.[0])} />
        <label htmlFor="upload-name">Input name</label>
        <input id="upload-name" maxLength={200} value={name} onChange={event => setName(event.target.value)} />
      </fieldset>
      {file && file.size > 8 * 1024 * 1024 && <p role="alert" className="error">Choose a file no larger than 8 MiB.</p>}
    </form>
    <FolderPicker workspace={workspace} selected={folder} select={selectFolder} disabled={state.retained} />
    {!state.retained && <button className="primary" type="submit" form={formId} disabled={!file || !name.trim() || file.size > 8 * 1024 * 1024}>Upload input</button>}
    <UploadProgress state={state} workflow={workflow.current} discard={discard} />
  </section>;
}

function UploadProgress({ state, workflow, discard }: {
  state: UploadState; workflow: UploadWorkflow | null; discard: () => void;
}) {
  return <div className="upload-progress" aria-live="polite">
    {state.message && <p role="status">{state.message}</p>}
    {state.record && <p className="number">Last confirmed: {state.record.state}, {state.record.offset} / {state.record.bytes} bytes</p>}
    {state.retained && <p>A partial backend input can remain after cancellation, departure, or clearing this local draft.</p>}
    <div className="actions">
      {state.busy ? <button onClick={() => workflow?.cancel()}>Cancel upload</button> : <UploadRecoveryActions state={state} run={action => {void workflow?.run(action);}} />}
      {state.retained && <button disabled={state.busy} onClick={discard}>{state.phase === 'complete' ? 'Clear completed draft' : 'Discard local draft'}</button>}
    </div>
  </div>;
}
