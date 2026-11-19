import type { RunHistorySummary } from '@beetle/contracts/api';

export function HistoryP95Sparkline({ points }: { points: NonNullable<RunHistorySummary['httpP95Preview']> }) {
  const first = points[0]!.offsetSeconds;
  const span = points.at(-1)!.offsetSeconds - first;
  const heightScale = Math.max(1, ...points.map((point) => point.p95Ms));
  const relative = points.map((point) => point.p95Ms / heightScale);
  const floor = Math.min(...relative);
  const range = Math.max(Number.EPSILON, Math.max(...relative) - floor);
  const positions = points.map((point, index) => ({
    x: 1 + (46 * (point.offsetSeconds - first)) / span,
    y: 13 - (11 * (relative[index]! - floor)) / range,
  }));
  const path = positions
    .map(({ x, y }, index) => `${index === 0 || points[index]!.gapBefore ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  return (
    <svg className="history-p95-sparkline" viewBox="0 0 48 15" role="img" aria-label="Sampled p95 latency over time">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.25" />
      {positions.map(({ x, y }, index) => (
        <circle key={points[index]!.offsetSeconds} cx={x} cy={y} r="0.9" fill="currentColor" />
      ))}
    </svg>
  );
}
