import type { ReactNode } from 'react';
import { clock } from '../live/format.js';
import type { PlanStage } from '../live/plan.js';

function offsetLabel(milliseconds: number): string {
  const fraction = milliseconds % 1000;
  const seconds = clock(milliseconds);
  if (fraction === 0) return seconds;
  return seconds + '.' + String(fraction).padStart(3, '0').replace(/0+$/, '');
}

export type StageScheduleRow = PlanStage & {
  readonly observation?: { readonly fromMs: number; readonly toMs: number };
};

/** Scheduled stage boundaries and measured latency share the scenario clock when available. */
export function StageSchedule({
  stages,
  scenarioStartedAtMs,
  riseOffset = null,
  latency,
}: {
  stages: readonly StageScheduleRow[];
  scenarioStartedAtMs?: number | undefined;
  riseOffset?: number | null;
  latency?: ReactNode;
}) {
  const anchored = scenarioStartedAtMs !== undefined;
  const rows = elapsedRows(stages, anchored, riseOffset, latency);
  const title = anchored ? 'Scenario timeline' : 'Scheduled stages';
  return (
    <>
      {rows.length > 0 && (
        <>
          <h3 className="result-milestone-heading">{title}</h3>
          <p className="result-muted">Stage offsets follow the saved schedule. HTTP windows show recorded samples.</p>
          <ol className="result-milestones" aria-label={title}>
            {rows.map((row) => (
              <li key={row.key}>
                <span className="number">{offsetLabel(row.offset)}</span>
                <div>{row.content}</div>
              </li>
            ))}
          </ol>
        </>
      )}
      {riseOffset === null && latency}
      <RecordedScenarioStart milliseconds={scenarioStartedAtMs} />
    </>
  );
}

function elapsedRows(
  stages: readonly StageScheduleRow[],
  anchored: boolean,
  riseOffset: number | null,
  latency: ReactNode,
) {
  const planOrigin = anchored ? (stages[0]?.startMs ?? 0) : 0;
  const rows: { offset: number; key: string; content: ReactNode }[] = stages.map((stage, index) => ({
    offset: stage.startMs - planOrigin,
    key: `stage-${index}`,
    content: <StageEvent stage={stage} />,
  }));
  if (riseOffset !== null) {
    rows.push({ offset: riseOffset, key: 'latency-rise', content: latency });
    rows.sort((a, b) => a.offset - b.offset);
  }
  return rows;
}

function StageEvent({ stage }: { stage: StageScheduleRow }) {
  return (
    <>
      {stage.label}
      {stage.observation && (
        <small className="stage-activity">
          HTTP samples in scenario window {offsetLabel(stage.observation.fromMs)}–{offsetLabel(stage.observation.toMs)}
        </small>
      )}
    </>
  );
}

function RecordedScenarioStart({ milliseconds }: { milliseconds: number | undefined }) {
  if (milliseconds === undefined) return null;
  const timestamp = new Date(milliseconds).toISOString();
  return (
    <p className="result-muted">
      k6 recorded the scenario start at <time dateTime={timestamp}>{timestamp}</time>.
    </p>
  );
}
