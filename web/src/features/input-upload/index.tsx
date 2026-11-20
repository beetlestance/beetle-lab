import { inputScopeKey } from './scope.js';
import { useId, useState } from 'react';
import type { ApiClient, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { useApi, useInputTransfers } from '../../app/api.js';
import { FolderPicker } from './FolderPicker.js';
import type { UploadState, UploadWorkflow } from './workflow.js';
import { useUploadOwner } from './useUploadOwner.js';
import { UploadRecoveryActions } from './recovery.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import type { ReactNode } from 'react';
import './upload.css';

/**
 * Prepared bytes and request identities retire with their workspace or client.
 * With `onClose` the form is Overlay / Upload input; closing it retires the draft.
 */
export function UploadInput({ workspace, onClose }: { workspace: Workspace; onClose?: () => void }) {
  const api = useApi();
  const transfers = useInputTransfers();
  if (!transfers)
    return (
      <section className="notice" aria-label="Upload input">
        <h2>Upload input</h2>
        <p>Input transfer is unavailable for this session.</p>
        <button disabled>Upload input</button>
      </section>
    );
  const identity = inputScopeKey(workspace, api, transfers);
  return (
    <UploadScope
      key={identity}
      workspace={workspace}
      api={api}
      transfers={transfers}
      {...(onClose ? { onClose } : {})}
    />
  );
}

function Frame({ onClose, busy, children }: { onClose?: () => void; busy: boolean; children: ReactNode }) {
  if (!onClose)
    return (
      <section className="input-upload content-section" aria-label="Upload input">
        <header>
          <h2>Upload input</h2>
        </header>
        {children}
      </section>
    );
  return (
    <Dialog
      title="Upload input"
      onClose={onClose}
      dismissible={!busy}
      actions={
        <Button variant="text" disabled={busy} onClick={onClose}>
          Close upload
        </Button>
      }
    >
      <div className="input-upload input-upload-dialog">{children}</div>
    </Dialog>
  );
}

type UploadScopeProps = { workspace: Workspace; api: ApiClient; transfers: InputTransferClient; onClose?: () => void };
function UploadScope({ workspace, api, transfers, onClose }: UploadScopeProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [folder, selectFolder] = useState({ id: workspace.rootFolderId, label: 'Workspace root' });
  const [generation, setGeneration] = useState(0);
  const { state, workflow } = useUploadOwner(api, transfers, workspace);
  function discard() {
    workflow.current?.discard();
    setFile(undefined);
    setName('');
    setGeneration((value) => value + 1);
  }
  return (
    <Frame busy={state.busy} {...(onClose ? { onClose } : {})}>
      <p className="upload-lede">
        Choose one file up to 8 MiB. The draft stays in memory and retires when you close this, leave this workspace or
        end the session.
      </p>
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (file) workflow.current?.start(file, name, folder.id);
        }}
      >
        <fieldset className="upload-fields" disabled={state.retained}>
          <label htmlFor="upload-file">Input file</label>
          <input
            key={generation}
            id="upload-file"
            type="file"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              setFile(chosen);
              if (chosen && !name.trim()) setName(chosen.name.slice(0, 128));
            }}
          />
          <label htmlFor="upload-name">Input name</label>
          <input id="upload-name" maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
        </fieldset>
        {file && file.size > 8 * 1024 * 1024 && (
          <p role="alert" className="error">
            Choose a file no larger than 8 MiB.
          </p>
        )}
      </form>
      <FolderPicker workspace={workspace} selected={folder} select={selectFolder} disabled={state.retained} />
      {!state.retained && (
        <Button
          variant="primary"
          type="submit"
          form={formId}
          disabled={!file || !name.trim() || file.size > 8 * 1024 * 1024}
        >
          Upload input
        </Button>
      )}
      <UploadProgress state={state} workflow={workflow.current} discard={discard} />
    </Frame>
  );
}

function UploadProgress({
  state,
  workflow,
  discard,
}: {
  state: UploadState;
  workflow: UploadWorkflow | null;
  discard: () => void;
}) {
  return (
    <div className="upload-progress" aria-live="polite">
      {state.message && <p role="status">{state.message}</p>}
      {state.record && (
        <div className="upload-confirmed">
          {state.record.bytes > 0 && (
            <progress aria-label="Confirmed upload bytes" value={state.record.offset} max={state.record.bytes} />
          )}
          <p className="number">
            Last confirmed: {state.record.state}, {state.record.offset} / {state.record.bytes} bytes
          </p>
        </div>
      )}
      {!state.busy && state.phase === 'refresh' && (
        <p>Refresh to confirm how many bytes Beetle kept. You can then resume with the file already selected.</p>
      )}
      {state.retained && (
        <p>A partial backend input can remain after cancellation, departure, or clearing this browser draft.</p>
      )}
      <div className="actions">
        {state.busy ? (
          <button onClick={() => workflow?.cancel()}>Cancel upload</button>
        ) : (
          <UploadRecoveryActions
            state={state}
            run={(action) => {
              void workflow?.run(action);
            }}
          />
        )}
        {state.retained && (
          <button disabled={state.busy} onClick={discard}>
            {state.phase === 'complete' ? 'Clear completed draft' : 'Discard browser draft'}
          </button>
        )}
      </div>
    </div>
  );
}
