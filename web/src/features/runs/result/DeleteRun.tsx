import type { Run } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import { Dialog } from '../../../components/Dialog.js';
import { RetentionControls } from '../../retention/index.js';
import { shortId } from '../../run-results/format.js';
import { usePin } from './usePin.js';

/**
 * Overlay / Delete run. Deletion goes through retention's protected preview and
 * explicit Apply (composed, not re-implemented). A pinned run is kept out of
 * retention, so the dialog offers Unpin first instead of a preview.
 */
export function DeleteRun({ run, onClose }: { run: Run; onClose(): void }) {
  const pin = usePin(run);
  const short = shortId(run.id);
  return (
    <Dialog
      title={`Delete run ${short}?`}
      description="Deleting removes the run, its metrics and its artifacts once the cleanup finishes. It cannot be undone."
      onClose={onClose}
      dismissible={!pin.write.pending}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      {pin.pinned ? (
        <div className="result-delete-pinned">
          <p>Run {short} is pinned, so retention keeps it. Unpin it first, then preview the deletion.</p>
          <Button loading={pin.write.pending} loadingLabel="Unpinning…" onClick={pin.toggle}>
            Unpin run {short}
          </Button>
          {pin.write.error && (
            <p role="alert" className="result-inline-error">
              The run could not be unpinned.{' '}
              {pin.write.error.unknown ? (
                <Button variant="text" size="sm" onClick={pin.write.retry}>
                  Retry the same unpin
                </Button>
              ) : null}
            </p>
          )}
        </div>
      ) : (
        <RetentionControls
          key={`${run.id}/${run.version}`}
          scope={run.scope}
          onKeep={onClose}
          run={{ id: run.id, version: run.version }}
        />
      )}
    </Dialog>
  );
}
