import type { PlanSummary, Stage } from './plan.js';
import { clock } from './plan.js';
import './overview.css';

const W = 880;
const H = 80;
/** Load-shape area chart, stage strip and total, from the first scenario's literal plan. */
function chartPath(points: readonly [number, number][], span: number): string[] {
  const peak = Math.max(1, ...points.map(([, value]) => value));
  return points.map(
    ([t, value]) => `${((t / (span || 1)) * W).toFixed(1)},${(H - (value / peak) * (H - 2) - 1).toFixed(1)}`,
  );
}
function summaryText(plan: PlanSummary, stages: number): string {
  return [
    plan.totalMs === null ? 'Length depends on the target' : `${clock(plan.totalMs)} in total`,
    stages ? `${stages} ${stages === 1 ? 'stage' : 'stages'}` : null,
    plan.scenarios > 1 ? `${plan.scenarios} scenarios; the chart shows the first` : null,
  ]
    .filter(Boolean)
    .join(', ');
}
export function LoadShape({ plan, compact = false }: { plan: PlanSummary; compact?: boolean }) {
  const { stages, points, headline } = plan.first ?? { stages: [], points: [], headline: null };
  const span = stages.reduce((total, stage) => total + stage.ms, 0);
  const path = chartPath(points, span);
  return (
    <div className={compact ? 'load-shape load-shape-compact' : 'load-shape'}>
      {path.length > 1 && <Chart path={path} label={headline ?? 'Load shape'} />}
      {stages.length > 0 && span > 0 && <StageStrip stages={stages} />}
      <p className="load-shape-total">{summaryText(plan, stages.length)}</p>
    </div>
  );
}
function Chart({ path, label }: { path: string[]; label: string }) {
  return (
    <svg
      className="load-shape-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon points={[`0,${H}`, ...path, `${W},${H}`].join(' ')} />
    </svg>
  );
}
function StageStrip({ stages }: { stages: readonly Stage[] }) {
  return (
    <ol className="load-shape-stages" aria-label="Stages">
      {stages.map((stage, index) => (
        <li key={index} style={{ flexGrow: stage.ms, flexBasis: 0 }}>
          <span className="load-shape-stage-text">
            {stage.kind === 'steady' ? <span>{stage.label}</span> : <strong>{stage.label}</strong>}
            <span className="number">{clock(stage.ms)}</span>
          </span>
          <span className="load-shape-bar" aria-hidden="true" />
        </li>
      ))}
    </ol>
  );
}
