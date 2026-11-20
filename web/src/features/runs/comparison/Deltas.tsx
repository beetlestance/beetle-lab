import type { ReactNode } from 'react';
import { ComparisonSlos } from './Slos.js';
import type { RunComparisonItem } from '@beetle/contracts/api';
import { Table, Td, Th } from '../../../components/Table.js';
import { formatLatency, formatDuration, formatNumber, formatPercent } from '../../run-results/format.js';
import { relativePercent } from './relative-percent.js';
import { comparisonRunLabels } from './run-labels.js';
import { comparisonFigures } from './figures.js';
import type { ComparisonFigures } from './figures.js';
import type { Summaries, Overviews, ComparisonHistories } from './useComparison.js';

type Row = {
  label: string;
  value(summary: ComparisonFigures): number | null;
  show(value: number): string | null;
  delta: 'relative' | 'points' | 'duration' | 'absolute';
};
const rows: readonly Row[] = [
  {
    label: 'Observed peak requests a second',
    value: (s) => s.peakRequestsPerSecond,
    show: (v) => formatNumber(v, 'integer'),
    delta: 'relative',
  },
  {
    label: 'Requests a second',
    value: (s) => s.requestsPerSecond,
    show: (v) => formatNumber(v, 'integer'),
    delta: 'relative',
  },
  { label: 'p50, histogram estimate', value: (s) => s.p50, show: formatLatency, delta: 'relative' },
  { label: 'p95, histogram estimate', value: (s) => s.p95, show: formatLatency, delta: 'relative' },
  { label: 'p99, histogram estimate', value: (s) => s.p99, show: formatLatency, delta: 'relative' },
  { label: 'Failed requests', value: (s) => s.failureRatio, show: (v) => formatPercent(v), delta: 'points' },
  { label: 'Checks passed', value: (s) => s.checksRatio, show: (v) => formatPercent(v), delta: 'points' },
  {
    label: 'Dropped iterations',
    value: (s) => s.droppedIterations,
    show: (v) => formatNumber(v, 'integer'),
    delta: 'absolute',
  },
  { label: 'Requests', value: (s) => s.requestCount, show: (v) => formatNumber(v, 'integer'), delta: 'relative' },
  { label: 'Length', value: (s) => s.testDurationMs, show: (v) => formatDuration(v), delta: 'duration' },
];

/** Client-side difference from the baseline, labelled; nothing when either side is unknown. */
export function delta(kind: Row['delta'], base: number | null, value: number | null): string | null {
  if (base === null || value === null || !Number.isFinite(base) || !Number.isFinite(value)) return null;
  if (value === base) return 'same';
  return deltaOf[kind](base, value);
}

const sign = (difference: number) => (difference > 0 ? '+' : '−');

const deltaOf: Record<Row['delta'], (base: number, value: number) => string | null> = {
  absolute(base, value) {
    return `${sign(value - base)}${formatNumber(Math.abs(value - base), 'integer')}`;
  },
  points(base, value) {
    const points = Math.round((value - base) * 10000) / 100;
    return `${sign(value - base)}${points === 0 ? '<0.01' : Math.abs(points)} pp`;
  },
  duration(base, value) {
    const text = formatDuration(Math.abs(value - base));
    return text ? `${sign(value - base)}${text}` : null;
  },
  relative(base, value) {
    const amount = relativePercent(base, value);
    return amount === null ? null : `${sign(value - base)}${amount}`;
  },
};

/** Direction colouring describes the change only; native verdicts remain independent. */
function deltaClass(label: string, base: number | null, value: number | null): string {
  if (base === null || value === null || base === value) return 'compare-delta';
  const higher = ['Observed peak requests a second', 'Checks passed'].includes(label);
  const lower = [
    'p50, histogram estimate',
    'p95, histogram estimate',
    'p99, histogram estimate',
    'Failed requests',
    'Dropped iterations',
  ].includes(label);
  if (!higher && !lower) return 'compare-delta';
  return `compare-delta ${(higher ? value < base : value > base) ? 'compare-change-worse' : 'compare-change-better'}`;
}

/** Whole-run figures per run with differences from the first (baseline) run. */
export function ComparisonDeltas({
  items,
  summaries,
  overviews,
  histories,
  headers,
}: {
  items: readonly RunComparisonItem[];
  headers: readonly ReactNode[];
  summaries: Summaries | undefined;
  overviews: Overviews | undefined;
  histories: ComparisonHistories | undefined;
}) {
  const values = items.map((item) =>
    comparisonFigures(
      summaries?.get(item.run.id.toLowerCase()),
      overviews?.get(item.run.id.toLowerCase()),
      histories?.get(item.run.id.toLowerCase()),
    ),
  );
  if (summaries === undefined) return <p role="status">Loading whole-run figures…</p>;
  return (
    <>
      <ComparisonReadNotes items={items} overviews={overviews} />
      {values.every((value) => value === null) && (
        <p className="compare-muted">Whole-run figures are unavailable for these runs.</p>
      )}
      <ComparisonSlos items={items}>
        {(sloRows) => <FiguresTable items={items} values={values} headers={headers} slos={sloRows} />}
      </ComparisonSlos>
      <details className="compare-additional">
        <summary>Additional whole-run figures</summary>
        <FiguresTable items={items} values={values} additional />
      </details>
    </>
  );
}
function FiguresTable({
  items,
  values,
  headers,
  slos,
  additional = false,
}: {
  items: readonly RunComparisonItem[];
  values: readonly (ComparisonFigures | null)[];
  headers?: readonly ReactNode[];
  slos?: ReactNode;
  additional?: boolean;
}) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  return (
    <Table
      caption={
        additional
          ? 'Additional whole-run figures'
          : "Whole-run figures and native thresholds, with each run's difference from the baseline"
      }
      className={additional ? 'compare-deltas compare-extra' : 'compare-deltas compare-summary'}
      scrollLabel={additional ? 'Additional whole-run figures' : 'Whole-run figures'}
      columns={[
        { key: 'metric', label: headers ? <span className="sr-only">Measure</span> : 'Measure' },
        ...items.map((item, index) => ({
          key: item.run.id,
          label: headers?.[index] ?? `${labels.get(item.run.id.toLowerCase())}${index === 0 ? ' (baseline)' : ''}`,
          numeric: true,
        })),
      ]}
    >
      {rows
        .filter((row) => additional === ['Requests a second', 'Requests'].includes(row.label))
        .map((row) => {
          const base = values[0] ? row.value(values[0]) : null;
          return (
            <tr key={row.label}>
              <Th scope="row" aria-label={row.label}>
                {row.label.replace(', histogram estimate', '').replace(/^Observed peak/, 'Peak')}
              </Th>
              {items.map((item, index) => {
                const summary = values[index];
                const value = summary ? row.value(summary) : null;
                const text = value === null ? null : row.show(value);
                const change = index === 0 ? null : delta(row.delta, base, value);
                return (
                  <Td key={item.run.id} numeric>
                    {text ?? <span aria-label="Unknown">—</span>}
                    {change && <span className={deltaClass(row.label, base, value)}>{change}</span>}
                  </Td>
                );
              })}
            </tr>
          );
        })}
      {slos}
      {additional && <AdditionalFactRows items={items} />}
    </Table>
  );
}

function AdditionalFactRows({ items }: { items: readonly RunComparisonItem[] }) {
  return (
    <>
      <tr>
        <Th scope="row">Required checks passed</Th>
        {items.map((item) => (
          <Td key={item.run.id} numeric>
            {item.result
              ? `${item.result.requiredAssertions.passed} of ${item.result.requiredAssertions.required}`
              : '—'}
          </Td>
        ))}
      </tr>
      <tr>
        <Th scope="row">Failed SLOs</Th>
        {items.map((item) => (
          <Td key={item.run.id} numeric>
            {item.result ? item.result.failedSloCount : '—'}
          </Td>
        ))}
      </tr>
    </>
  );
}

function ComparisonReadNotes({
  items,
  overviews,
}: {
  items: readonly RunComparisonItem[];
  overviews: Overviews | undefined;
}) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  return (
    <div className="compare-muted">
      <p>
        Peak rate comes from recorded windows; additional rates are whole-run averages. Latencies are histogram
        estimates.
      </p>
      {items.map((item) => {
        const read = overviews?.get(item.run.id.toLowerCase());
        if (!read) return null;
        if (read.status === 'error')
          return (
            <p role="alert" key={item.run.id}>
              {labels.get(item.run.id.toLowerCase())}: detailed measurements could not be loaded. Available saved
              history figures remain below.
            </p>
          );
        if (read.value.availability !== 'ready')
          return (
            <p key={item.run.id}>
              {labels.get(item.run.id.toLowerCase())}: detailed measurements{' '}
              {read.value.availability.replaceAll('_', ' ')}. Unknown fields stay missing.
            </p>
          );
        return read.value.source?.coverage.complete === false ? (
          <p key={item.run.id}>{labels.get(item.run.id.toLowerCase())}: partial window coverage.</p>
        ) : null;
      })}
    </div>
  );
}
