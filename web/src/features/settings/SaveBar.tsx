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
        ? 'Changes saved.'
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
      title={unknown ? 'Beetle did not confirm the save.' : 'Not saved.'}
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
  onRefresh,
  onDiscard,
  onClose,
}: {
  name: string;
  count: number;
  onRefresh: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Changed elsewhere"
      role="alertdialog"
      onClose={onClose}
      description={`Settings for ${name} were saved somewhere else after this page read them, so your ${changes(count)} ${count === 1 ? 'was' : 'were'} not saved.`}
      actions={
        <>
          <Button variant="text" onClick={onDiscard}>
            Discard my changes
          </Button>
          <Button variant="primary" onClick={onRefresh}>
            Refresh latest version
          </Button>
        </>
      }
    >
      <p>Refreshing keeps your changes on top of the latest values. Check them, then save again.</p>
    </Dialog>
  );
}
