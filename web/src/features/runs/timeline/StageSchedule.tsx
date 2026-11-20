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

/** Scheduled offsets and contained observations retain their distinct time references. */
export function StageSchedule({ stages }: { stages: readonly StageScheduleRow[] }) {
  if (stages.length === 0) return null;
  return (
    <>
      <h3 className="result-milestone-heading">Scheduled stages</h3>
      <p className="result-muted">Offsets from the saved load plan. Actual transitions can differ.</p>
      <ol className="result-milestones" aria-label="Scheduled stages">
        {stages.map((stage, index) => (
          <li key={index}>
            <span className="number">{offsetLabel(stage.startMs)}</span>
            <span>
              {stage.label}
              {stage.observation && (
                <small className="stage-activity">
                  HTTP samples in scenario window {offsetLabel(stage.observation.fromMs)}–
                  {offsetLabel(stage.observation.toMs)}
                </small>
              )}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function RecordedScenarioStart({ milliseconds }: { milliseconds: number | undefined }) {
  if (milliseconds === undefined) return null;
  const timestamp = new Date(milliseconds).toISOString();
  return (
    <p>
      k6 recorded the scenario start at <time dateTime={timestamp}>{timestamp}</time>.
    </p>
  );
}
