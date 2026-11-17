import { useState } from 'react';
import { errorMessage, unknownOutcome } from '../../app/api.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { TextInput } from '../../components/Fields.js';
import type { Target } from './useDeletion.js';
import { useDeletion } from './useDeletion.js';

const copy: Record<Target['kind'], { verb: string; action: string; body: string }> = {
  workspace: {
    verb: 'Retire',
    action: 'Retire workspace',
    body: 'Hides the workspace from lists. Its suites, run history, receipts and stored files are kept, and their storage is not freed. Refused while runs, exports or uploads are unfinished. This cannot be undone; the name becomes free to reuse.',
  },
  organization: {
    verb: 'Retire',
    action: 'Retire organization',
    body: 'Hides the organization from lists. Retire its workspaces first; Beetle refuses while any are live. Retained history still uses storage. This cannot be undone; the name becomes free to reuse.',
  },
  folder: {
    verb: 'Delete',
    action: 'Delete folder',
    body: 'Only an empty folder can be deleted. Move or delete its suites, inputs and folders first.',
  },
};

/**
 * Overlay / Delete workspace, organization and folder: type the exact name to confirm.
 * Beetle owns the refusal (live workspaces, unfinished work, a non-empty folder); its
 * reason is shown as returned and never guessed.
 */
export function ConfirmDeletion({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState('');
  const deletion = useDeletion(target, onDone);
  const { state } = deletion;
  const text = copy[target.kind];
  const name = target.entity.name;
  const pending = state.phase === 'pending';
  const unknown = state.phase === 'failed' && unknownOutcome(state.failure);
  return (
    <Dialog
      title={`${text.verb} ${name}?`}
      role="alertdialog"
      onClose={onClose}
      dismissible={!pending}
      description={text.body}
      actions={
        <>
          <Button variant="text" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          {unknown ? (
            <Button variant="danger" onClick={deletion.replay}>
              Retry identical request
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={typed !== name}
              loading={pending}
              loadingLabel={`${text.verb === 'Retire' ? 'Retiring' : 'Deleting'}…`}
              onClick={deletion.confirm}
            >
              {text.action}
            </Button>
          )}
        </>
      }
    >
      <TextInput
        label={`Type ${name} to confirm`}
        value={typed}
        disabled={pending || unknown}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setTyped(event.target.value)}
      />
      {state.phase === 'failed' && (
        <Banner tone="danger" title={unknown ? 'Beetle did not confirm this.' : `${text.verb} was refused.`}>
          <p>{errorMessage(state.failure)}</p>
          {unknown && <p>It may already be done. Retry sends the identical request.</p>}
        </Banner>
      )}
    </Dialog>
  );
}
