import { useState } from 'react';
import { errorMessage, unknownOutcome } from '../../app/api.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { TextInput } from '../../components/Fields.js';
import type { DeletionState, Target } from './useDeletion.js';
import { useDeletion } from './useDeletion.js';

export type Mode = 'delete' | 'retire';

interface Copy {
  title: string;
  body: string;
  cancel: string;
  action: string;
  refused: string;
}

/** Board copy: Overlay / Delete workspace, Retire workspace, Retire organization, and the Refused / Blocked / Not empty titles. */
function copyFor(target: Target, mode: Mode): Copy {
  const name = target.entity.name;
  if (target.kind === 'workspace' && mode === 'retire')
    return {
      title: `Retire ${name}?`,
      body: 'The workspace disappears from lists and search. Its suites, run history, receipts and stored files are kept, and their storage is not freed. You cannot undo this.',
      cancel: 'Cancel',
      action: 'Retire workspace',
      refused: `${name} can’t be retired yet`,
    };
  if (target.kind === 'workspace')
    return {
      title: `Delete ${name}?`,
      body: `${name} leaves every list and its name becomes free to reuse. Its suites, runs, results, pins and settings stay on disk and still count toward storage, so deleting it frees no space.`,
      cancel: 'Not now',
      action: `Delete ${name}`,
      refused: `${name} can't be deleted yet`,
    };
  if (target.kind === 'organization' && mode === 'retire')
    return {
      title: `Retire ${name}?`,
      body: `${name} disappears from the organization menu and search, and its address becomes free to reuse. Retire its workspaces first; an organization with active workspaces is refused. Its history stays on disk and still counts toward storage. You cannot undo this.`,
      cancel: 'Cancel',
      action: 'Retire organization',
      refused: `${name} still has active workspaces`,
    };
  if (target.kind === 'organization')
    return {
      title: `Delete ${name}?`,
      body: `${name} leaves every list and its address becomes free to reuse. Delete its workspaces first; an organization with active workspaces is refused. Its history stays on disk and still counts toward storage.`,
      cancel: 'Not now',
      action: `Delete ${name}`,
      refused: `${name} still has active workspaces`,
    };
  return {
    title: `Delete ${name}?`,
    body: 'Only an empty folder can be deleted. Deleting never removes suites or inputs for you.',
    cancel: 'Not now',
    action: `Delete ${name}`,
    refused: `${name} isn't empty`,
  };
}

/**
 * Type the exact name to confirm. Beetle owns the refusal (active workspaces, unfinished
 * work, a non-empty folder); its message is shown as returned and never guessed.
 */
export function ConfirmDeletion({
  target,
  mode = 'delete',
  onClose,
  onDone,
}: {
  target: Target;
  mode?: Mode;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState('');
  const deletion = useDeletion(target, onDone);
  const { state } = deletion;
  const copy = copyFor(target, mode);
  const unknown = state.phase === 'failed' && unknownOutcome(state.failure);
  if (state.phase === 'failed' && !unknown)
    return (
      <Dialog
        title={copy.refused}
        role="alertdialog"
        onClose={onClose}
        description={errorMessage(state.failure)}
        actions={<Button onClick={onClose}>Close</Button>}
      />
    );
  return (
    <Dialog
      title={copy.title}
      role="alertdialog"
      onClose={onClose}
      dismissible={state.phase !== 'pending'}
      description={copy.body}
      actions={
        <Actions copy={copy} state={state} ready={typed === target.entity.name} deletion={deletion} onClose={onClose} />
      }
    >
      <TextInput
        label={`Type ${target.entity.name} to confirm`}
        value={typed}
        disabled={state.phase === 'pending' || unknown}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setTyped(event.target.value)}
      />
      {unknown && (
        <Banner tone="danger" title="Beetle did not confirm this.">
          <p>{errorMessage(state.failure)}</p>
          <p>It may already be done. Retry sends the identical request.</p>
        </Banner>
      )}
    </Dialog>
  );
}

function Actions({
  copy,
  state,
  ready,
  deletion,
  onClose,
}: {
  copy: Copy;
  state: DeletionState;
  ready: boolean;
  deletion: ReturnType<typeof useDeletion>;
  onClose: () => void;
}) {
  const pending = state.phase === 'pending';
  return (
    <>
      <Button variant="text" disabled={pending} onClick={onClose}>
        {copy.cancel}
      </Button>
      {state.phase === 'failed' ? (
        <Button variant="danger" onClick={deletion.replay}>
          Retry identical request
        </Button>
      ) : (
        <Button variant="danger" disabled={!ready} loading={pending} loadingLabel="Working…" onClick={deletion.confirm}>
          {copy.action}
        </Button>
      )}
    </>
  );
}
