import { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { errorMessage, useApi } from '../../../app/api.js';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import { Button } from '../../../components/Button.js';
import { runStatus } from '../../run-results/format.js';
import { usePin } from './usePin.js';
import { useWrite } from './useWrite.js';
import type { Write } from './useWrite.js';

/** Header of the Run result boards: status, verdict title, summary sentence, actions. */
export function ResultHeader({
  run,
  title,
  sentence,
  readOnly,
  onDelete,
  refresh,
}: {
  run: Run;
  title: string;
  sentence: string;
  readOnly: boolean;
  onDelete(): void;
  /** RunDetail's run re-read; available even in read-only history. */
  refresh?: { readonly run: () => void; readonly busy: boolean } | undefined;
}) {
  const status = runStatus(run);
  return (
    <header className="result-head">
      <div className="result-head-main">
        <h1 className="result-title">{title}</h1>
        {sentence && <p className="result-sentence">{sentence}</p>}
      </div>
      <div className="result-head-side">
        <div className="result-row">
          <Status tone={status.tone}>{status.label}</Status>
          {refresh && (
            <Button variant="text" size="sm" onClick={refresh.run} disabled={refresh.busy}>
              Refresh run
            </Button>
          )}
        </div>
        {readOnly ? (
          <p className="result-readonly-note">Read-only history: actions are unavailable.</p>
        ) : (
          <div className="result-actions">
            <RunAgain run={run} />
            <PinControl run={run} />
            <Button variant="text" size="sm" onClick={onDelete}>
              Delete run…
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}

function WriteError({ write, label }: { write: Write; label: string }) {
  if (!write.error) return null;
  return (
    <p role="alert" className="result-inline-error">
      {errorMessage(write.error.failure)}
      {write.error.unknown && (
        <>
          {' '}
          The outcome is unknown.{' '}
          <Button variant="text" size="sm" onClick={write.retry} disabled={write.pending}>
            {label}
          </Button>
        </>
      )}
    </p>
  );
}

/** Starts the same saved revision with the run's own profile, budget and policy. */
function RunAgain({ run }: { run: Run }) {
  const api = useApi();
  const navigate = useNavigate();
  const { organizationId, workspaceId } = run.scope;
  const write = useWrite(`${organizationId}/${workspaceId}/${run.id}/again`);
  const body = useRef<Parameters<typeof api.createRun>[0]['body'] | null>(null);
  function start() {
    body.current = {
      scope: run.scope,
      requestId: crypto.randomUUID(),
      revisionId: run.revisionId,
      engineProfile: run.engine.profileId,
      budget: run.budget,
      executionPolicy: run.executionPolicy,
    };
    const captured = body.current;
    write.start(
      (signal) => api.createRun({ params: { organizationId, workspaceId }, body: captured, signal }),
      (created) => void navigate(routes.run(organizationId, workspaceId, created.id)),
    );
  }
  return (
    <span className="result-action">
      <Button variant="primary" size="sm" loading={write.pending} loadingLabel="Starting…" onClick={start}>
        Run again
      </Button>
      <WriteError write={write} label="Retry the same start" />
    </span>
  );
}

function PinControl({ run }: { run: Run }) {
  const pin = usePin(run);
  const { organizationId, workspaceId } = run.scope;
  const hidden = run.state !== 'finished' && run.state !== 'cancelled' && run.state !== 'errored';
  if (hidden) return null;
  return (
    <span className="result-action">
      <Button
        size="sm"
        aria-pressed={pin.pinned}
        loading={pin.write.pending}
        loadingLabel={pin.pinned ? 'Unpinning…' : 'Pinning…'}
        disabled={pin.reason === 'cleanup_in_progress'}
        onClick={pin.toggle}
      >
        {pin.pinned ? '✓ Pinned' : 'Pin this run'}
      </Button>
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
    </span>
  );
}
