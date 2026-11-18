import type { PlanStage, RunPlan } from './plan.js';
import type { LiveFigures } from './model.js';
import { clock, ms, percent, wallTime, whole } from './format.js';

type StageState = 'done' | 'now' | 'next';

function stageState(stage: PlanStage, elapsedMs: number | null): StageState {
  if (elapsedMs === null || elapsedMs < stage.startMs) return 'next';
  return elapsedMs >= stage.startMs + stage.durationMs ? 'done' : 'now';
}

function stageFill(stage: PlanStage, state: StageState, elapsedMs: number | null): number {
  if (state === 'done') return 100;
  if (state === 'next' || elapsedMs === null) return 0;
  return ((elapsedMs - stage.startMs) / stage.durationMs) * 100;
}

function Stage({ stage, elapsedMs }: { stage: PlanStage; elapsedMs: number | null }) {
  const state = stageState(stage, elapsedMs);
  return (
    <li
      className={`live-stage is-${state}${stage.drain ? ' is-drain' : ''}`}
      style={{ flexGrow: stage.durationMs }}
      aria-current={state === 'now' ? 'step' : undefined}
    >
      <span className="live-stage-label">
        <span className="number">{clock(stage.durationMs)}</span>
        {state === 'done' ? <span aria-label="done"> ✓</span> : <span> {stage.label}</span>}
      </span>
      <span className="live-stage-track">
        <span style={{ width: `${stageFill(stage, state, elapsedMs)}%` }} />
      </span>
    </li>
  );
}

function Stages({ plan, elapsedMs }: { plan: RunPlan; elapsedMs: number | null }) {
  if (plan.stages.length === 0 || plan.totalMs === null) return null;
  return (
    <ol className="live-stages" aria-label="Load stages">
      {plan.stages.map((stage) => (
        <Stage key={stage.startMs} stage={stage} elapsedMs={elapsedMs} />
      ))}
    </ol>
  );
}

function TimeLine({
  totalMs,
  elapsedMs,
  originMs,
}: {
  totalMs: number | null;
  elapsedMs: number | null;
  originMs: number | null;
}) {
  if (elapsedMs === null)
    return (
      <div className="live-time">
        <span>Elapsed time unavailable</span>
      </div>
    );
  const known = totalMs !== null && totalMs > 0;
  return (
    <div className="live-time">
      <span>
        <span className="number">{clock(elapsedMs)}</span> elapsed
        {known && originMs !== null && (
          <>
            {' '}
            <span className="live-left">
              {clock(Math.max(0, totalMs - elapsedMs))} left
              <span className="live-end">, ends about {wallTime(originMs + totalMs)}</span>
            </span>
          </>
        )}
      </span>
      {known && <span className="live-percent number">{Math.round(Math.min(1, elapsedMs / totalMs) * 100)}%</span>}
    </div>
  );
}

const limitText = (limit: number | null, format: (n: number) => string) =>
  limit === null ? '' : `, limit ${format(limit)}`;
const orNull = <T,>(value: T | null | undefined, format: (v: T) => string) =>
  value === null || value === undefined ? null : format(value);

/** Before the first window every figure is unknown; "complete" keeps the plain requests label. */
const noFigures: Pick<LiveFigures, 'rps' | 'p95' | 'failedRatio' | 'vus' | 'vusMax' | 'complete'> = {
  rps: null,
  p95: null,
  failedRatio: null,
  vus: null,
  vusMax: null,
  complete: true,
};

function Kpis({
  figures,
  p95Limit,
  failedLimit,
  compact,
}: {
  compact: boolean;
  figures: LiveFigures | null;
  p95Limit: number | null;
  failedLimit: number | null;
}) {
  const f = figures ?? noFigures;
  const slowest = f.p95?.slowest ? ', slowest endpoint' : '';
  const vusMax = orNull(f.vusMax, (n) => ` of ${whole(n)}`) ?? '';
  return (
    <dl className="live-kpis">
      <Kpi
        value={orNull(f.rps, whole)}
        label={f.complete ? 'requests a second' : 'requests a second (some endpoints not in live view)'}
      />
      <Kpi value={orNull(f.p95?.value, ms)} label={`p95 latency${slowest}${limitText(p95Limit, ms)}`} />
      <Kpi value={orNull(f.failedRatio, percent)} label={`failed${limitText(failedLimit, percent)}`} />
      {!compact && <Kpi value={orNull(f.vus, whole)} label={`virtual users busy${vusMax}`} />}
    </dl>
  );
}

/** Stage bar and rounded planned-time percentage; figures describe the latest window. */
export function Progress({
  plan,
  elapsedMs,
  originMs,
  figures,
  p95Limit,
  failedLimit,
  compact = false,
}: {
  compact?: boolean | undefined;
  plan: RunPlan;
  elapsedMs: number | null;
  originMs: number | null;
  figures: LiveFigures | null;
  p95Limit: number | null;
  failedLimit: number | null;
}) {
  return (
    <section className="live-progress" aria-label="Progress">
      <Stages plan={plan} elapsedMs={elapsedMs} />
      <TimeLine totalMs={plan.totalMs} elapsedMs={elapsedMs} originMs={originMs} />
      <Kpis compact={compact} figures={figures} p95Limit={p95Limit} failedLimit={failedLimit} />
    </section>
  );
}

function Kpi({ value, label }: { value: string | null; label: string }) {
  return (
    <div className="live-kpi">
      <dt>{label}</dt>
      <dd className="number">{value ?? <span title="No reading in the latest window">–</span>}</dd>
    </div>
  );
}
