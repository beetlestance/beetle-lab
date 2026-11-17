import { useState } from 'react';
import type { ApiClient, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { useApi, useInputTransfers } from '../../app/api.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { TextInput } from '../../components/Fields.js';
import { UploadRecoveryActions } from '../input-upload/recovery.js';
import { inputScopeKey } from '../input-upload/scope.js';
import { useUploadOwner } from '../input-upload/useUploadOwner.js';
import type { UploadState, UploadWorkflow } from '../input-upload/workflow.js';
import { freeName, samples } from './samples.js';
import type { SampleId } from './samples.js';
import './sample.css';

interface SampleProps {
  workspace: Workspace;
  /** Names on the listed inventory page, for the "Name taken" check. */
  names: readonly string[];
  /** True when the listed page is the whole inventory, so the name check is exact. */
  complete: boolean;
  onClose: () => void;
}

/** Add a sample file (and / Name taken): a generated file through the normal upload. */
export function AddSampleFile(props: SampleProps) {
  const api = useApi();
  const transfers = useInputTransfers();
  if (!transfers) return null;
  return (
    <SampleScope key={inputScopeKey(props.workspace, api, transfers)} {...props} api={api} transfers={transfers} />
  );
}

function SampleScope({
  workspace,
  names,
  complete,
  onClose,
  api,
  transfers,
}: SampleProps & { api: ApiClient; transfers: InputTransferClient }) {
  const [choice, setChoice] = useState<SampleId>('users');
  const sample = samples.find((item) => item.id === choice)!;
  const [name, setName] = useState(sample.name);
  const { state, workflow } = useUploadOwner(api, transfers, workspace);
  const taken = new Set(names);
  const trimmed = name.trim();
  const nameTaken = !state.retained && taken.has(trimmed);
  const add = () => {
    if (!trimmed || nameTaken) return;
    const type = trimmed.endsWith('.json') ? 'application/json' : 'text/csv';
    workflow.current?.start(new File([sample.content()], trimmed, { type }), trimmed, workspace.rootFolderId);
  };
  return (
    <Dialog
      title="Add a sample file"
      onClose={onClose}
      dismissible={!state.busy}
      description="Generated in your browser and uploaded like any other input, to the workspace root."
      actions={
        <>
          <Button variant="text" disabled={state.busy} onClick={onClose}>
            {state.phase === 'complete' ? 'Close' : 'Cancel'}
          </Button>
          {!state.retained && (
            <Button variant="primary" disabled={!trimmed || nameTaken} onClick={add}>
              Add sample
            </Button>
          )}
        </>
      }
    >
      <SampleChoices
        choice={choice}
        disabled={state.retained}
        choose={(id, sampleName) => {
          setChoice(id);
          setName(sampleName);
        }}
      />
      <TextInput
        label="Input name"
        value={name}
        maxLength={128}
        disabled={state.retained}
        onChange={(event) => setName(event.target.value)}
        error={nameTaken ? `An input named ${trimmed} already exists in this workspace.` : undefined}
        hint={complete ? undefined : 'Only names on the listed page are checked.'}
      />
      {nameTaken && (
        <Button size="sm" variant="text" onClick={() => setName(freeName(trimmed, taken))}>
          Use {freeName(trimmed, taken)}
        </Button>
      )}
      <SampleProgress state={state} workflow={workflow.current} />
    </Dialog>
  );
}

function SampleChoices({
  choice,
  disabled,
  choose,
}: {
  choice: SampleId;
  disabled: boolean;
  choose: (id: SampleId, name: string) => void;
}) {
  return (
    <fieldset className="sample-choices" disabled={disabled}>
      <legend className="sr-only">Sample</legend>
      {samples.map((item) => (
        <label key={item.id} className="sample-choice">
          <input
            type="radio"
            name="sample"
            value={item.id}
            checked={choice === item.id}
            onChange={() => choose(item.id, item.name)}
          />
          <span>
            <strong>{item.name}</strong> <span className="sample-title">{item.title}</span>
            <span className="sample-description">
              {item.description} {item.rows} rows, {item.columns} {item.columns === 1 ? 'column' : 'columns'}.
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function SampleProgress({ state, workflow }: { state: UploadState; workflow: UploadWorkflow | null }) {
  return (
    <div className="sample-progress" aria-live="polite">
      {state.message && <p role="status">{state.message}</p>}
      {state.busy ? (
        <Button size="sm" onClick={() => workflow?.cancel()}>
          Cancel upload
        </Button>
      ) : (
        <div className="actions">
          <UploadRecoveryActions state={state} run={(action) => void workflow?.run(action)} />
        </div>
      )}
    </div>
  );
}
