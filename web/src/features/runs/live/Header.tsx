import { useId } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import type { StatusTone } from '../../../components/Badge.js';
import { Button } from '../../../components/Button.js';
import type { useCancellation } from '../useCancellation.js';
import { shortId, wallTime } from './format.js';

export type Cancellation = ReturnType<typeof useCancellation>;

export interface HeaderProps {
  run: Run;
  suiteName: string | null;
  revisionOrdinal: number | null;
  headline: string;
  sentence: ReactNode;
  status: { label: string; tone: StatusTone; note?: string | undefined };
  /** Null hides the control (stream not running and not paused). */
  stream: { paused: boolean; toggle: () => void } | null;
  cancel: Cancellation | undefined;
  readOnly: boolean;
  onScript: () => void;
}

const cancelRequested = (run: Run, cancel: Cancellation | undefined) =>
  run.cancellationRequested || cancel?.accepted === true;

function ContextLine({ run, suiteName, revisionOrdinal }: Pick<HeaderProps, 'run' | 'suiteName' | 'revisionOrdinal'>) {
  const started = run.startedAt ? `started ${wallTime(run.startedAt)}` : `requested ${wallTime(run.requestedAt)}`;
  return (
    <p className="live-context">
      <Link to={routes.runs(run.scope.organizationId, run.scope.workspaceId)}>Runs</Link>
      <span aria-hidden="true"> / </span>
      {suiteName ?? 'Suite'} (k6 load test), run <span className="number">{shortId(run.id)}</span>
      {revisionOrdinal !== null && `, revision ${revisionOrdinal}`}, {started}
    </p>
  );
}

function CompareButton() {
  const tip = useId();
  return (
    <span className="live-tip-anchor">
      <Button size="sm" aria-disabled="true" aria-describedby={tip} onClick={() => undefined}>
        Compare
      </Button>
      <span role="tooltip" id={tip} className="live-tip">
        Compare with another run once this one has finished: comparisons read sealed results.
      </span>
    </span>
  );
}

/** Cancel run, only while the run can still be cancelled from this session. */
function CancelButton({ run, cancel, readOnly }: Pick<HeaderProps, 'run' | 'cancel' | 'readOnly'>) {
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  if (!cancel || terminal || readOnly || cancelRequested(run, cancel)) return null;
  return (
    <Button
      variant="primary"
      loading={cancel.pending}
      loadingLabel="Cancelling…"
      disabled={cancel.unknown}
      onClick={() => void cancel.request()}
    >
      Cancel run
    </Button>
  );
}

function CancelAlert({ run, cancel }: Pick<HeaderProps, 'run' | 'cancel'>) {
  if (!cancel?.message || cancelRequested(run, cancel)) return null;
  return (
    <div role="alert" className="live-alert">
      <p>{cancel.message}</p>
      {cancel.unknown && (
        <Button size="sm" disabled={cancel.pending} onClick={() => void cancel.request()}>
          Retry same cancellation
        </Button>
      )}
    </div>
  );
}

/** Title block of the Live run boards: context line, headline, sentence and actions. */
export function LiveHeader(props: HeaderProps) {
  const { status, stream } = props;
  return (
    <header className="live-header">
      <ContextLine run={props.run} suiteName={props.suiteName} revisionOrdinal={props.revisionOrdinal} />
      <div className="live-title-row">
        <div>
          <h1>{props.headline}</h1>
          <p className="live-sentence">{props.sentence}</p>
        </div>
        <div className="live-side">
          <p className="live-status">
            <Status tone={status.tone}>{status.label}</Status>
            {status.note && <span className="live-muted"> · {status.note}</span>}
          </p>
          <div className="live-actions">
            <CompareButton />
            <Button size="sm" onClick={props.onScript}>
              Script
            </Button>
            {stream && <Button onClick={stream.toggle}>{stream.paused ? 'Resume stream' : 'Pause stream'}</Button>}
            <CancelButton run={props.run} cancel={props.cancel} readOnly={props.readOnly} />
          </div>
        </div>
      </div>
      <CancelAlert run={props.run} cancel={props.cancel} />
    </header>
  );
}
