import { Link } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { useSessionAccess } from '../../../app/session.js';
import { Button } from '../../../components/Button.js';
import { Badge } from '../../../components/Badge.js';
import { usePin } from './usePin.js';
import { terminal } from '../terminal.js';
import { WriteError } from './WriteError.js';

export function PinControl({ run, compact = false, label }: { run: Run; compact?: boolean; label?: string }) {
  const pin = usePin(run);
  const { readOnly } = useSessionAccess();
  if (!terminal(run)) return null;
  if (readOnly) return run.pinned ? <Badge tone="strong">Pinned at backup</Badge> : null;
  return (
    <span className={compact ? 'history-pin' : 'result-action'}>
      <PinButton pin={pin} compact={compact} label={label} />
      <PinFeedback pin={pin} run={run} />
    </span>
  );
}

type Pin = ReturnType<typeof usePin>;
function PinButton({ pin, compact, label }: { pin: Pin; compact: boolean; label: string | undefined }) {
  return (
    <Button
      size="sm"
      variant={compact ? 'text' : 'secondary'}
      aria-label={label ? `${pin.pinned ? 'Unpin' : 'Pin'} run ${label}` : undefined}
      aria-pressed={pin.pinned}
      loading={pin.write.pending}
      loadingLabel={pin.pinned ? 'Unpinning…' : 'Pinning…'}
      disabled={pin.reason === 'cleanup_in_progress' || !!pin.write.error?.unknown}
      onClick={pin.toggle}
    >
      <PinLabel compact={compact} pinned={pin.pinned} />
    </Button>
  );
}

function PinFeedback({ pin, run }: { pin: Pin; run: Run }) {
  const { organizationId, workspaceId } = run.scope;
  return (
    <>
      {pin.reason === 'pin_limit' ? (
        <p role="alert" className="result-inline-error">
          256 runs are pinned in this workspace. Unpin one to pin this run.{' '}
          <Link to={routes.pinnedRuns(organizationId, workspaceId)}>See pinned runs</Link>
        </p>
      ) : pin.reason === 'cleanup_in_progress' ? (
        <p role="alert" className="result-inline-error">
          This run is being removed, so it can no longer be pinned.
        </p>
      ) : (
        <>
          <WriteError write={pin.write} label="Retry" />
          {pin.write.error && !pin.write.error.unknown && (
            <Button variant="text" size="sm" onClick={pin.toggle}>
              Try again
            </Button>
          )}
        </>
      )}
    </>
  );
}

function PinLabel({ compact, pinned }: { compact: boolean; pinned: boolean }) {
  return (
    <>
      {compact ? (
        <>
          <span aria-hidden="true">{pinned ? '◆' : '◇'}</span> <span>{pinned ? 'Pinned' : 'Pin'}</span>
        </>
      ) : pinned ? (
        '✓ Pinned'
      ) : (
        'Pin this run'
      )}
    </>
  );
}
