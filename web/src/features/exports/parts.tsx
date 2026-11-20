import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ExportJob } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { VerifiedExportDownload } from './VerifiedDownload.js';
import { elapsedText, exportSteps, stepIndex } from './prepare.js';
import type { useExportWrite } from './useWrite.js';

/** Pieces the revision and run export dialogs share. Cancellation needs only its own write. */
export type CancelFlow = { cancel: ReturnType<typeof useExportWrite> };

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function CancelButton({ job, flow }: { job: ExportJob; flow: CancelFlow }) {
  const params = { organizationId: job.scope.organizationId, workspaceId: job.scope.workspaceId, exportId: job.id };
  return (
    <Button
      variant="secondary"
      disabled={job.cancellationRequested || flow.cancel.pending || flow.cancel.unknown || flow.cancel.id !== null}
      onClick={() =>
        void flow.cancel.send({ kind: 'cancel', params, body: { scope: job.scope, requestId: crypto.randomUUID() } })
      }
    >
      {job.cancellationRequested ? 'Cancelling…' : 'Cancel export'}
    </Button>
  );
}

export function Steps({ job }: { job: ExportJob | undefined }) {
  const now = useNow(!!job);
  const current = job ? stepIndex(job.state) : 0;
  return (
    <ol className="export-steps">
      {exportSteps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'next';
        return (
          <li key={step.label} className={`export-step export-step-${state}`}>
            <span className="export-step-mark" aria-hidden="true">
              {state === 'done' ? '✓' : state === 'current' ? '●' : '○'}
            </span>
            <span>
              {step.label}
              <span className="sr-only">
                {state === 'done' ? ', done' : state === 'current' ? ', in progress' : ''}
              </span>
            </span>
            {state === 'current' && job && (
              <span className="export-step-time">for {elapsedText(job.requestedAt, now)} since the request</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Facts({ items }: { items: readonly [string, ReactNode][] }) {
  return (
    <dl className="export-facts">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExportTime({ value }: { value: string | null | undefined }) {
  if (!value) return <>Not recorded</>;
  if (!Number.isFinite(Date.parse(value)))
    return (
      <time dateTime={value} title={value}>
        {value}
      </time>
    );
  return (
    <time dateTime={value} title={value}>
      {new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))}
    </time>
  );
}

export function CancelFailure({ flow }: { flow: CancelFlow }) {
  if (!flow.cancel.message) return null;
  return (
    <div role="alert" className="export-cancel-error">
      <p className="field-error">{flow.cancel.message}</p>
      {flow.cancel.unknown && (
        <Button size="sm" disabled={flow.cancel.pending} onClick={() => void flow.cancel.send()}>
          Replay export cancellation
        </Button>
      )}
    </div>
  );
}

export function ReadyActions({ job, zip }: { job: ExportJob; zip: boolean }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const digest = job.artifact!.sha256;
  return (
    <>
      <Button
        variant="secondary"
        onClick={() =>
          navigator.clipboard?.writeText(digest).then(
            () => setCopied('done'),
            () => setCopied('failed'),
          ) ?? setCopied('failed')
        }
      >
        {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy not available' : 'Copy SHA-256'}
      </Button>
      <VerifiedExportDownload
        job={job}
        format={zip ? 'zip' : 'script'}
        label={zip ? 'Download ZIP' : 'Download script'}
      />
    </>
  );
}
