import type { RunPlan } from './plan.js';
import type { LiveFigures } from './model.js';
import { clock, ms, percent, wallTime, whole } from './format.js';

/** Stage bar, time left and the four headline figures for the latest window. */
export function Progress({
  plan,
  elapsedMs,
  originMs,
  figures,
  p95Limit,
  failedLimit,
}: {
  plan: RunPlan;
  elapsedMs: number | null;
  originMs: number | null;
  figures: LiveFigures | null;
  p95Limit: number | null;
  failedLimit: number | null;
}) {
  const total = plan.totalMs;
  const known = elapsedMs !== null && total !== null && total > 0;
  const done = known ? Math.min(1, elapsedMs / total) : null;
  return (
    <section className="live-progress" aria-label="Progress">
      {plan.stages.length > 0 && total !== null && (
        <ol className="live-stages" aria-label="Load stages">
          {plan.stages.map((stage) => {
            const end = stage.startMs + stage.durationMs;
            const state =
              elapsedMs === null ? 'next' : elapsedMs >= end ? 'done' : elapsedMs >= stage.startMs ? 'now' : 'next';
            const fill =
              state === 'now' && elapsedMs !== null ? ((elapsedMs - stage.startMs) / stage.durationMs) * 100 : 0;
            return (
              <li
                key={stage.startMs}
                className={`live-stage is-${state}${stage.drain ? ' is-drain' : ''}`}
                style={{ flexGrow: stage.durationMs }}
                aria-current={state === 'now' ? 'step' : undefined}
              >
                <span className="live-stage-label">
                  <span className="number">{clock(stage.durationMs)}</span>
                  {state === 'done' ? <span aria-label="done"> ✓</span> : <span> {stage.label}</span>}
                </span>
                <span className="live-stage-track">
                  <span style={{ width: `${state === 'done' ? 100 : fill}%` }} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="live-time">
        <span>
          {elapsedMs === null ? (
            'Start time not reported'
          ) : (
            <>
              <span className="number">{clock(elapsedMs)}</span> elapsed
            </>
          )}
          {known && originMs !== null && (
            <>
              {' '}
              <span className="live-left">
                {clock(Math.max(0, total - elapsedMs))} left, ends about {wallTime(originMs + total)}
              </span>
            </>
          )}
        </span>
        {done !== null && <span className="live-percent number">{Math.floor(done * 100)}%</span>}
      </div>
      <dl className="live-kpis">
        <Kpi
          value={figures?.rps == null ? null : whole(figures.rps)}
          label={
            figures && !figures.complete ? 'requests a second (some endpoints not in live view)' : 'requests a second'
          }
        />
        <Kpi
          value={figures?.p95 ? ms(figures.p95.value) : null}
          label={`p95 latency${figures?.p95?.slowest ? ', slowest endpoint' : ''}${p95Limit !== null ? `, limit ${ms(p95Limit)}` : ''}`}
        />
        <Kpi
          value={figures?.failedRatio == null ? null : percent(figures.failedRatio)}
          label={`failed${failedLimit !== null ? `, limit ${percent(failedLimit)}` : ''}`}
        />
        <Kpi
          value={figures?.vus == null ? null : whole(figures.vus)}
          label={`virtual users busy${figures?.vusMax != null ? ` of ${whole(figures.vusMax)}` : ''}`}
        />
      </dl>
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
