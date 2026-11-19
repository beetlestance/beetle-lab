import type { RunComparisonItem } from '@beetle/contracts/api';
import type { ChartSeries, ChartTick } from '../live/LiveChart.js';
import { recordedPlot, sourceClock } from '../result/chart-model.js';
import type { ComparisonHistories } from './useComparison.js';
import { comparisonRunLabels } from './run-labels.js';
const tones = ['ink', 'amber', 'violet', 'info'] as const;
export interface RecordedCurve {
  readonly id: string;
  readonly label: string;
  readonly tone: ChartSeries['tone'];
  readonly xs: readonly number[];
  readonly breaks: readonly boolean[];
  readonly p95: readonly (number | null)[];
  readonly requests: readonly (number | null)[];
}
export interface ComparisonPlot {
  readonly curves: readonly RecordedCurve[];
  readonly domain: readonly [number, number];
  readonly ticks: readonly ChartTick[];
}
/** Actual source positions per run; no union grid, forward fill or phase realignment. */
export function comparisonPlot(
  items: readonly RunComparisonItem[],
  histories: ComparisonHistories | undefined,
): ComparisonPlot {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  const curves: RecordedCurve[] = [];
  const starts = [0],
    ends = [1000];
  items.forEach((item, index) => {
    const id = item.run.id.toLowerCase();
    const read = histories?.get(id);
    if (read?.status !== 'loaded') return;
    const plot = recordedPlot(read.value);
    if (!plot) return;
    starts.push(plot.domain[0]);
    ends.push(plot.domain[1]);
    curves.push({
      id,
      label: `${labels.get(id)}${index === 0 ? ' (baseline)' : ''}`,
      tone: tones[index]!,
      xs: plot.points.map((point) => point.t),
      breaks: plot.points.map((point) => point.gapBefore),
      p95: plot.points.map((point) => point.p95),
      requests: plot.points.map((point) => point.rps),
    });
  });
  const domain = [Math.min(...starts), Math.max(...ends)] as const;
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const at = domain[0] + ((domain[1] - domain[0]) * index) / 4;
    return { at, label: sourceClock(at) };
  });
  return { curves, domain, ticks };
}
