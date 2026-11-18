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
      <SealingEvents rows={rows} omitted={timeline.data?.omitted === true} retained={retained} />
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
function SealingEvents({ rows, omitted, retained }: { rows: readonly Row[]; omitted: boolean; retained: boolean }) {
  const sealed = rows.filter((row) => row.kind === 'artifact.sealed').length;
  const report = rows.some((row) => row.kind === 'engine.result');
  const sealedLabel = sealed
    ? `${omitted ? 'At least ' : ''}${sealed} ${sealed === 1 ? 'file' : 'files'} sealed`
    : 'Waiting for sealed files';
  return (
    <ul
      className="live-sealing-steps"
      aria-label={retained ? 'Last recorded sealing events' : 'Recorded sealing events'}
    >
      <li className={report ? 'is-done' : 'is-pending'}>
        <span aria-hidden="true">●</span>
        {report ? 'Engine report written' : 'Waiting for the engine report'}
      </li>
      <li className={sealed > 0 ? 'is-done' : 'is-pending'}>
        <span aria-hidden="true">●</span>
        {sealedLabel}
      </li>
      <li className="is-pending">
        <span aria-hidden="true">●</span>Awaiting final confirmation
      </li>
    </ul>
  );
}
