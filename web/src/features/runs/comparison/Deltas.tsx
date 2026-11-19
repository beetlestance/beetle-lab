import type { RunComparisonItem } from '@beetle/contracts/api';
import { Table, Td, Th } from '../../../components/Table.js';
import { formatBytes, formatDuration, formatNumber, formatPercent, shortId } from '../../run-results/format.js';
import { comparisonFigures } from './figures.js';
import type { ComparisonFigures } from './figures.js';
import type { Summaries, Overviews } from './useComparison.js';

type Row = {
  label: string;
  value(summary: ComparisonFigures): number | null;
  show(value: number): string | null;
  delta: 'relative' | 'points' | 'duration' | 'absolute';
};
const rows: readonly Row[] = [
  {
    label: 'Requests a second',
    value: (s) => s.requestsPerSecond,
    show: (v) => formatNumber(v, 'integer'),
    delta: 'relative',
  },
  {
    label: 'p50, histogram estimate',
    value: (s) => s.p50,
    show: (v) => `${formatNumber(v, 'integer')} ms`,
    delta: 'relative',
  },
  {
    label: 'p95, histogram estimate',
    value: (s) => s.p95,
    show: (v) => `${formatNumber(v, 'integer')} ms`,
    delta: 'relative',
  },
  {
    label: 'p99, histogram estimate',
    value: (s) => s.p99,
    show: (v) => `${formatNumber(v, 'integer')} ms`,
    delta: 'relative',
  },
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
    return points === 0 ? 'same' : `${sign(points)}${Math.abs(points)} pp`;
  },
  duration(base, value) {
    const text = formatDuration(Math.abs(value - base));
    return text ? `${sign(value - base)}${text}` : null;
  },
  relative(base, value) {
    if (base === 0) return null;
    const change = ((value - base) / base) * 100;
    if (!Number.isFinite(change)) return null;
    const percent = Math.round(change);
    return percent === 0 ? 'same' : `${sign(percent)}${Math.abs(percent)}%`;
  },
};

/** Whole-run figures per run with differences from the first (baseline) run. */
export function ComparisonDeltas({
  items,
  summaries,
  overviews,
}: {
  items: readonly RunComparisonItem[];
  summaries: Summaries | undefined;
  overviews: Overviews | undefined;
}) {
  const values = items.map((item) =>
    comparisonFigures(summaries?.get(item.run.id.toLowerCase()), overviews?.get(item.run.id.toLowerCase())),
  );
  if (summaries === undefined) return <p role="status">Loading whole-run figures…</p>;
  return (
    <>
      <ComparisonReadNotes items={items} overviews={overviews} />
      {values.every((value) => value === null) ? (
        <p className="compare-muted">Whole-run figures are unavailable for these runs.</p>
      ) : (
        <FiguresTable items={items} values={values} />
      )}
    </>
  );
}
function FiguresTable({
  items,
  values,
}: {
  items: readonly RunComparisonItem[];
  values: readonly (ComparisonFigures | null)[];
}) {
  return (
    <Table
      caption="Whole-run figures, with each run's difference from the baseline"
      className="compare-deltas"
      columns={[
        { key: 'metric', label: 'Measure' },
        ...items.map((item, index) => ({
          key: item.run.id,
          label: `${shortId(item.run.id)}${index === 0 ? ' (baseline)' : ''}`,
          numeric: true,
        })),
      ]}
    >
      {rows.map((row) => {
        const base = values[0] ? row.value(values[0]) : null;
        return (
          <tr key={row.label}>
            <Th scope="row">{row.label}</Th>
            {items.map((item, index) => {
              const summary = values[index];
              const value = summary ? row.value(summary) : null;
              const text = value === null ? null : row.show(value);
              const change = index === 0 ? null : delta(row.delta, base, value);
              return (
                <Td key={item.run.id} numeric>
                  {text ?? <span aria-label="Unknown">—</span>}
                  {change && <span className="compare-delta">{change}</span>}
                </Td>
              );
            })}
          </tr>
        );
      })}
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
    </Table>
  );
}

function ComparisonReadNotes({
  items,
  overviews,
}: {
  items: readonly RunComparisonItem[];
  overviews: Overviews | undefined;
}) {
  return (
    <div className="compare-muted">
      <p>Request rates are whole-run averages; latency values are histogram estimates.</p>
      {items.map((item) => {
        const read = overviews?.get(item.run.id.toLowerCase());
        if (!read) return null;
        if (read.status === 'error')
          return (
            <p role="alert" key={item.run.id}>
              {shortId(item.run.id)}: detailed measurements could not be loaded. Available saved history figures remain
              below.
            </p>
          );
        if (read.value.availability !== 'ready')
          return (
            <p key={item.run.id}>
              {shortId(item.run.id)}: detailed measurements {read.value.availability.replaceAll('_', ' ')}. Unknown
              fields stay missing.
            </p>
          );
        return read.value.source?.coverage.complete === false ? (
          <p key={item.run.id}>{shortId(item.run.id)}: partial window coverage.</p>
        ) : null;
      })}
    </div>
  );
}

/** "What was different": recorded run settings side by side; equal values say same. */
export function WhatWasDifferent({ items }: { items: readonly RunComparisonItem[] }) {
  const facts: readonly [string, (item: RunComparisonItem) => string][] = [
    ['Revision', (item) => item.run.revisionDigest.slice(0, 8)],
    ['Engine profile', (item) => `${item.run.engine.id} / ${item.run.engine.profileId}`],
    ['Memory limit', (item) => formatBytes(item.run.budget.memoryBytes) ?? '—'],
    ['Time limit', (item) => formatDuration(item.run.budget.timeoutMs) ?? '—'],
    ['Execution policy', (item) => item.run.executionPolicy.mode],
    ['Note', (item) => item.run.note ?? 'None'],
  ];
  return (
    <Table
      caption="What was different between the runs"
      className="compare-different"
      columns={[
        { key: 'fact', label: 'Setting' },
        ...items.map((item) => ({ key: item.run.id, label: shortId(item.run.id) })),
      ]}
    >
      {facts.map(([label, read]) => {
        const base = read(items[0]!);
        return (
          <tr key={label}>
            <Th scope="row">{label}</Th>
            {items.map((item, index) => {
              const value = read(item);
              return (
                <Td key={item.run.id} muted={index > 0 && value === base && label !== 'Note'}>
                  {value}
                </Td>
              );
            })}
          </tr>
        );
      })}
    </Table>
  );
}
