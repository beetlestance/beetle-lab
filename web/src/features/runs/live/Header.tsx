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

/** Title block of the Live run boards: context line, headline, sentence and actions. */
export function LiveHeader(props: HeaderProps) {
  const { run, cancel } = props;
  const tip = useId();
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  const requested = run.cancellationRequested || cancel?.accepted === true;
  const started = run.startedAt ? `started ${wallTime(run.startedAt)}` : `requested ${wallTime(run.requestedAt)}`;
  return (
    <header className="live-header">
      <p className="live-context">
        <Link to={routes.runs(run.scope.organizationId, run.scope.workspaceId)}>Runs</Link>
        <span aria-hidden="true"> / </span>
        {props.suiteName ?? 'Suite'} (k6 load test), run <span className="number">{shortId(run.id)}</span>
        {props.revisionOrdinal !== null && `, revision ${props.revisionOrdinal}`}, {started}
      </p>
      <div className="live-title-row">
        <div>
          <h1>{props.headline}</h1>
          <p className="live-sentence">{props.sentence}</p>
        </div>
        <div className="live-side">
          <p className="live-status">
            <Status tone={props.status.tone}>{props.status.label}</Status>
            {props.status.note && <span className="live-muted"> · {props.status.note}</span>}
          </p>
          <div className="live-actions">
            <span className="live-tip-anchor">
              <Button size="sm" aria-disabled="true" aria-describedby={tip} onClick={() => undefined}>
                Compare
              </Button>
              <span role="tooltip" id={tip} className="live-tip">
                Compare with another run once this one has finished: comparisons read sealed results.
              </span>
            </span>
            <Button size="sm" onClick={props.onScript}>
              Script
            </Button>
            {props.stream && (
              <Button onClick={props.stream.toggle}>{props.stream.paused ? 'Resume stream' : 'Pause stream'}</Button>
            )}
            {cancel && !terminal && !props.readOnly && !requested && (
              <Button
                variant="primary"
                loading={cancel.pending}
                loadingLabel="Cancelling…"
                disabled={cancel.unknown}
                onClick={() => void cancel.request()}
              >
                Cancel run
              </Button>
            )}
          </div>
        </div>
      </div>
      {cancel?.message && !requested && (
        <div role="alert" className="live-alert">
          <p>{cancel.message}</p>
          {cancel.unknown && (
            <Button size="sm" disabled={cancel.pending} onClick={() => void cancel.request()}>
              Retry same cancellation
            </Button>
          )}
        </div>
      )}
    </header>
  );
}
