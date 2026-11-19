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
  const limit = (metric: string, stat: string) =>
    plan.rules.find((rule) => rule.metric === metric && rule.stat === stat)?.value ?? null;
  return (
    <section className="live-progress live-finalizing" aria-label="Sealing results">
      <SealingTime lastT={lastT} totalMs={plan.totalMs} />
      <div className="live-early-meter" role="progressbar" aria-label="Sealing results">
        <span />
      </div>
      <SealingEvents
        rows={rows}
        incomplete={timeline.data?.coverage !== 'contiguous' || timeline.data.omitted || timeline.data.backlog}
        retained={retained}
        sampledTarget={plan.samplingIntervalMs !== null}
      />
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

function SealingTime({ lastT, totalMs }: { lastT: number | null; totalMs: number | null }) {
  return (
    <div className="live-time">
      <span>
        {lastT === null ? 'Last live window unavailable' : `Last live window at ${clock(lastT)}`}
        {lastT !== null && totalMs !== null && ` of ${clock(totalMs)}`}
      </span>
      <span>Sealing results</span>
    </div>
  );
}
function SealingEvents({
  rows,
  incomplete,
  retained,
  sampledTarget,
}: {
  rows: readonly Row[];
  incomplete: boolean;
  retained: boolean;
  sampledTarget: boolean;
}) {
  const sealed = rows.filter((row) => row.kind === 'artifact.sealed').length;
  const report = rows.some((row) => row.artifactKind === 'performance-report' || row.kind === 'engine.result');
  const collecting = rows.some((row) => row.kind === 'phase.started' && row.phase === 'collect');
  const sealing = rows.some((row) => row.kind === 'phase.started' && row.phase === 'seal');
  const collected = collecting || sealing;
  const files = sealedFileLabel(sealed, incomplete);
  return (
    <ul
      className="live-sealing-steps"
      aria-label={retained ? 'Last recorded sealing events' : 'Recorded sealing events'}
    >
      <SealingStep done={report} label={report ? 'Engine report written' : 'Waiting for the engine report'} />
      <SealingStep done={sealed > 0} label={files} />
      {sampledTarget && (
        <SealingStep
          done={collected}
          label={collected ? 'Target sampler closed' : 'Waiting for target sampler closure'}
        />
      )}
      <SealingStep done={sealing} label={collectionLabel(collected, sealing)} />
    </ul>
  );
}

function sealedFileLabel(count: number, incomplete: boolean): string {
  if (count === 0) return 'Waiting for sealed files';
  return `${incomplete ? 'At least ' : ''}${count} ${count === 1 ? 'file' : 'files'} sealed`;
}

function collectionLabel(collected: boolean, sealing: boolean): string {
  if (sealing) return 'Artifact collection complete. Awaiting final confirmation';
  return collected ? 'Artifact collection started' : 'Awaiting artifact collection';
}

function SealingStep({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={done ? 'is-done' : 'is-pending'}>
      <span aria-hidden="true">●</span>
      {label}
    </li>
  );
}
