import { RunRequester } from '../RunRequester.js';
import { useWorkspaceSnapshot } from '../../../app/overview.js';
import { useSessionAccess } from '../../../app/session.js';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import type { StatusTone } from '../../../components/Badge.js';
import { Button } from '../../../components/Button.js';
import type { useCancellation } from '../useCancellation.js';
import './header.css';
import { HeaderIcon } from './HeaderIcon.js';
import { LiveDownloads } from './Downloads.js';
import type { ProvisionalSnapshot } from './provisional-download.js';
import { useLiveNamespace } from './data.js';
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
  retryStream?: (() => void) | undefined;
  cancel: Cancellation | undefined;
  readOnly: boolean;
  early?: boolean | undefined;
  snapshot: ProvisionalSnapshot | null;
  onScript: () => void;
}

const cancelRequested = (run: Run, cancel: Cancellation | undefined) =>
  run.cancellationRequested || cancel?.accepted === true;

function WorkspaceCrumb({ run }: { run: Run }) {
  const namespace = useLiveNamespace(run);
  const { readOnly } = useSessionAccess();
  useWorkspaceSnapshot(
    run.scope.organizationId,
    run.scope.workspaceId,
    !readOnly && namespace.organization.isSuccess && namespace.workspace.isSuccess,
  );
  const failed = namespace.organization.isError || namespace.workspace.isError;
  const name = !failed && namespace.workspace.isSuccess ? namespace.workspace.data.name : null;
  return (
    <>
      {name ? (
        <Link to={routes.workspace(run.scope.organizationId, run.scope.workspaceId)}>{name}</Link>
      ) : (
        <span>{failed ? 'Workspace unavailable' : 'Reading workspace…'}</span>
      )}
      {failed && (
        <Button size="sm" variant="text" disabled={namespace.busy} onClick={namespace.retry}>
          Retry workspace name
        </Button>
      )}
    </>
  );
}

function ContextLine({
  run,
  suiteName,
  revisionOrdinal,
  early,
}: Pick<HeaderProps, 'run' | 'suiteName' | 'revisionOrdinal' | 'early'>) {
  const started = run.startedAt
    ? `started ${wallTime(run.startedAt) || run.startedAt}`
    : `requested ${wallTime(run.requestedAt) || run.requestedAt}`;
  const revision =
    revisionOrdinal === null ? null : (
      <Link
        to={routes.suiteScriptFromRun(
          run.scope.organizationId,
          run.scope.workspaceId,
          run.suiteId,
          run.revisionId,
          run.id,
        )}
      >
        revision {revisionOrdinal}
      </Link>
    );
  return (
    <p className="live-context">
      <WorkspaceCrumb run={run} />
      {' / '}
      <Link to={routes.runs(run.scope.organizationId, run.scope.workspaceId)}>Runs</Link>
      <span aria-hidden="true"> / </span>
      {early ? (
        <>
          {suiteName ?? 'Suite'}
          {revision && <> · {revision}</>} · {started}
        </>
      ) : (
        <>
          {suiteName ?? 'Suite'} (k6 load test), run <span className="number">{shortId(run.id)}</span>
          {revision && <>, {revision}</>}, {started}
        </>
      )}
      {' · '}
      <RunRequester run={run} />
    </p>
  );
}

function CompareButton() {
  const tip = useId();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span className="live-tip-anchor" data-dismissed={dismissed}>
      <Button
        className="live-icon-action"
        aria-label="Compare"
        aria-disabled="true"
        aria-describedby={tip}
        onFocus={() => setDismissed(false)}
        onMouseEnter={() => setDismissed(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDismissed(true);
        }}
        onClick={() => undefined}
      >
        <HeaderIcon kind="compare" />
      </Button>
      <span role="tooltip" id={tip} className="live-tip">
        Compare with another run once this one has finished: comparisons read sealed results.
      </span>
    </span>
  );
}

/** Cancel run, only while the run can still be cancelled from this session. */
export function LiveCancelButton({
  run,
  cancel,
  readOnly,
  early,
}: Pick<HeaderProps, 'run' | 'cancel' | 'readOnly' | 'early'>) {
  const terminal = ['finished', 'cancelled', 'errored'].includes(run.state);
  if (terminal || readOnly || run.state === 'finalizing') return null;
  const variant = early ? 'secondary' : 'inverse';
  if (cancelRequested(run, cancel))
    return (
      <Button variant={variant} disabled>
        Cancelling…
      </Button>
    );
  if (!cancel) return null;
  return (
    <Button
      variant={variant}
      loading={cancel.pending}
      loadingLabel="Sending"
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
    <header className={`live-header${props.early ? ' is-early' : ''}`}>
      <ContextLine
        early={props.early}
        run={props.run}
        suiteName={props.suiteName}
        revisionOrdinal={props.revisionOrdinal}
      />
      <div className="live-title-row">
        <div>
          <h1>{props.headline}</h1>
        </div>
        {!props.early && (
          <div className="live-side">
            <p className="live-status">
              <Status tone={status.tone}>{status.label}</Status>
              {status.note && <span className="live-muted"> · {status.note}</span>}
            </p>
            <div className="live-actions">
              <CompareButton />
              <LiveDownloads ordinal={props.revisionOrdinal} snapshot={props.snapshot} onScript={props.onScript} />
              {props.retryStream ? (
                <Button onClick={props.retryStream}>Retry now</Button>
              ) : (
                stream && <Button onClick={stream.toggle}>{stream.paused ? 'Resume stream' : 'Pause stream'}</Button>
              )}
              <LiveCancelButton run={props.run} cancel={props.cancel} readOnly={props.readOnly} />
            </div>
          </div>
        )}
      </div>
      <p className="live-sentence">{props.sentence}</p>
      <CancelAlert run={props.run} cancel={props.cancel} />
    </header>
  );
}
