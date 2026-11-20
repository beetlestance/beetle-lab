import type { RunComparisonItem } from '@beetle/contracts/api';
import { inlineComparisonFailure } from './FailedSlos.js';
import { comparisonFigures } from './figures.js';
import { comparisonRunLabels } from './run-labels.js';
import { relativePercent } from './relative-percent.js';
import type { Summaries, Overviews } from './useComparison.js';

/** Describes recorded histogram estimates; never infers a cause or a native verdict. */
export function ComparisonHeadline({
  items,
  summaries,
  overviews,
}: {
  items: readonly RunComparisonItem[];
  summaries: Summaries | undefined;
  overviews: Overviews | undefined;
}) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  const values = items.map(
    (item) =>
      comparisonFigures(summaries?.get(item.run.id.toLowerCase()), overviews?.get(item.run.id.toLowerCase()))?.p95 ??
      null,
  );
  return items.slice(1).map((item, index) => (
    <span className="compare-headline" key={item.run.id}>
      {labels.get(item.run.id.toLowerCase())}: {p95Change(values[0] ?? null, values[index + 1] ?? null)}{' '}
      {inlineComparisonFailure(item)}
    </span>
  ));
}

/** Relative changes require a nonzero baseline; rounded zero is never called unchanged. */
export function p95Change(base: number | null, value: number | null): string {
  if (base === null || value === null || !Number.isFinite(base) || !Number.isFinite(value))
    return 'Recorded p95 comparison unavailable.';
  if (base === value) return 'Recorded p95 estimate unchanged from the baseline.';
  if (base === 0) return 'Recorded p95 percentage unavailable: the baseline is zero.';
  const change = relativePercent(base, value);
  if (change === null) return 'Recorded p95 percentage unavailable.';
  const amount = change.replace(/^</, 'less than ').replace(/^>/, 'more than ');
  return `Recorded p95 estimate ${amount} ${value > base ? 'higher' : 'lower'} than the baseline.`;
}
