import { errorMessage, unknownOutcome } from '../../app/api.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import type { SavePhase } from './useSave.js';

const changes = (count: number) => (count === 1 ? '1 unsaved change' : `${count} unsaved changes`);

/** The sticky save bar: count of unsaved changes for this level, Discard, Save. */
export function SaveBar({
  name,
  count,
  invalid,
  state,
  onSave,
  onDiscard,
}: {
  name: string;
  count: number;
  invalid: number;
  state: SavePhase;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const pending = state.phase === 'pending';
  const blocked = state.phase === 'failed' && unknownOutcome(state.failure);
  const message =
    count === 0
      ? state.phase === 'saved'
        ? `Saved. New runs in ${name} use these values; runs already started keep theirs.`
        : 'No unsaved changes.'
      : invalid > 0
        ? `${changes(count)} in ${name}. Fix ${invalid === 1 ? 'the marked value' : 'the marked values'} to save.`
        : `${changes(count)} in ${name}.`;
  return (
    <div className={count > 0 ? 'settings-savebar settings-savebar-dirty' : 'settings-savebar'}>
      <p role="status">{message}</p>
      <div className="settings-savebar-actions">
        <Button variant="text" size="sm" disabled={count === 0 || pending} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={count === 0 || invalid > 0 || blocked}
          loading={pending}
          loadingLabel="Saving…"
          onClick={onSave}
        >
          Save {name}
        </Button>
      </div>
    </div>
  );
}

/** A refused or unknown save. Unknown outcomes offer only the identical replay; a conflict opens the overlay. */
export function SaveFailure({ state, onReplay }: { state: SavePhase; onReplay: () => void }) {
  if (state.phase !== 'failed' || state.failure.protocol?.code === 'conflict') return null;
  const unknown = unknownOutcome(state.failure);
  return (
    <Banner
      tone="danger"
      title={unknown ? 'Beetle did not confirm the save.' : 'Couldn’t save. Nothing was changed.'}
      actions={
        unknown && (
          <Button size="sm" onClick={onReplay}>
            Retry identical request
          </Button>
        )
      }
    >
      <p>{errorMessage(state.failure)}</p>
      {unknown && <p>It may have been saved. Retry sends the identical request; editing a value starts a new save.</p>}
    </Banner>
  );
}

/** Settings / Changed elsewhere: someone saved this level after it was read. The draft is kept. */
export function ChangedElsewhere({
  name,
  count,
  onReload,
  onClose,
}: {
  name: string;
  count: number;
  onReload: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Settings changed since you opened them"
      role="alertdialog"
      onClose={onClose}
      description={`Someone saved ${name} settings after this page read them. Your ${changes(count)} ${count === 1 ? 'was' : 'were'} kept here; reload to see theirs, then save yours again.`}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Keep editing
          </Button>
          <Button variant="primary" onClick={onReload}>
            Reload settings
          </Button>
        </>
      }
    />
  );
}
