import type { Run } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import type { Row } from '../timeline/projection.js';
import { useTimeline } from '../timeline/useTimeline.js';
import type { LiveFigures } from './model.js';
import type { RunPlan } from './plan.js';
import { clock } from './format.js';
import { Kpis } from './Progress.js';

/** Sealing is indeterminate. Only the event stream can confirm completed work. */
export function Finalizing({
  run,
  plan,
  figures,
  lastT,
}: {
  run: Run;
  plan: RunPlan;
  figures: LiveFigures | null;
  lastT: number | null;
}) {
  const timeline = useTimeline(run, false);
  const rows = timeline.data?.rows ?? [];
  const retained = timeline.isError && timeline.data !== undefined;
  const incomplete = timeline.data?.coverage !== 'contiguous' || timeline.data.omitted || timeline.data.backlog;
  const sealed = rows.filter((row) => row.kind === 'artifact.sealed').length;
  const limit = (metric: string, stat: string) =>
    plan.rules.find((rule) => rule.metric === metric && rule.stat === stat)?.value ?? null;
  return (
    <section className="live-progress live-finalizing" aria-label="Sealing results">
      <SealingTime lastT={lastT} totalMs={plan.totalMs} files={sealedFileLabel(sealed, incomplete || retained)} />
      <div className="live-early-meter" role="progressbar" aria-label="Sealing results">
        <span />
      </div>
      <SealingEvents rows={rows} retained={retained} sampledTarget={plan.samplingIntervalMs !== null} />
      {timeline.isError && (
        <p role="alert">
          {retained
            ? 'Sealing events could not be refreshed; last recorded events are shown.'
            : 'Sealing events could not be read.'}{' '}
          <Button
            size="sm"
            disabled={timeline.isFetching}
            onClick={() => void timeline.refetch({ cancelRefetch: false })}
          >
            Retry sealing events
          </Button>
        </p>
      )}
      <Kpis
        compact={false}
        figures={figures}
        p95Limit={limit('http_req_duration', 'p95')}
        failedLimit={limit('http_req_failed', 'rate')}
      />
    </section>
  );
}

function SealingTime({ lastT, totalMs, files }: { lastT: number | null; totalMs: number | null; files: string }) {
  return (
    <div className="live-time">
      <span>
        {lastT === null ? 'Last live window unavailable' : `Last live window at ${clock(lastT)}`}
        {lastT !== null && totalMs !== null && ` of ${clock(totalMs)}`}
      </span>
      <span>{files}</span>
    </div>
  );
}
function SealingEvents({
  rows,
  retained,
  sampledTarget,
}: {
  rows: readonly Row[];
  retained: boolean;
  sampledTarget: boolean;
}) {
  const report = rows.some((row) => row.artifactKind === 'performance-report' || row.kind === 'engine.result');
  const collecting = rows.some((row) => row.kind === 'phase.started' && row.phase === 'collect');
  const complete = rows.some(
    (row) =>
      (row.kind === 'phase.started' && row.phase === 'seal') ||
      (row.kind === 'phase.finished' && row.phase === 'collect'),
  );
  const collected = collecting || complete;
  return (
    <ul
      className="live-sealing-steps"
      aria-label={retained ? 'Last recorded sealing events' : 'Recorded sealing events'}
    >
      <SealingStep
        state={report ? 'done' : 'pending'}
        label={report ? 'Engine report written' : 'Waiting for the engine report'}
      />
      <CollectionStep started={collected} complete={complete} retained={retained} />
      {sampledTarget && (
        <SealingStep
          state={collected ? 'done' : 'pending'}
          label={collected ? 'Target sampler closed' : 'Waiting for target sampler closure'}
        />
      )}
    </ul>
  );
}

function sealedFileLabel(count: number, incomplete: boolean): string {
  if (count === 0) return 'Sealing results';
  return `${incomplete ? 'At least ' : ''}${count} ${count === 1 ? 'file' : 'files'} sealed`;
}

function CollectionStep({ started, complete, retained }: { started: boolean; complete: boolean; retained: boolean }) {
  if (complete) return <SealingStep state="done" label="Artifact collection complete. Awaiting final confirmation" />;
  if (!started) return <SealingStep state="pending" label="Awaiting artifact collection" />;
  return <SealingStep state={retained ? 'pending' : 'active'} label="Artifact collection started" />;
}

function SealingStep({ state, label }: { state: 'done' | 'active' | 'pending'; label: string }) {
  return (
    <li className={`is-${state}`}>
      <span aria-hidden="true">●</span>
      {label}
    </li>
  );
}
