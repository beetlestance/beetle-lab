import type { RunComparisonItem, RunHistorySummary } from '@beetle/contracts/api';
import { Table, Td, Th } from '../../../components/Table.js';
import { formatBytes, formatDuration, formatNumber, formatPercent, shortId } from '../../run-results/format.js';
import type { Summaries } from './useComparison.js';

type Row = {
  label: string;
  value(summary: RunHistorySummary): number | null;
  show(value: number): string | null;
  delta: 'relative' | 'points' | 'duration';
};
const rows: readonly Row[] = [
  {
    label: 'Requests a second',
    value: (s) => s.requestsPerSecond,
    show: (v) => formatNumber(v, 'integer'),
    delta: 'relative',
  },
  {
    label: 'p95, histogram estimate',
    value: (s) => s.httpP95?.estimate ?? null,
    show: (v) => `${formatNumber(v, 'integer')} ms`,
    delta: 'relative',
  },
  { label: 'Failed requests', value: (s) => s.httpFailureRatio, show: (v) => formatPercent(v), delta: 'points' },
  { label: 'Requests', value: (s) => s.requestCount, show: (v) => formatNumber(v, 'integer'), delta: 'relative' },
  { label: 'Length', value: (s) => s.testDurationMs, show: (v) => formatDuration(v), delta: 'duration' },
];

/** Client-side difference from the baseline, labelled; nothing when either side is unknown. */
export function delta(kind: Row['delta'], base: number | null, value: number | null): string | null {
  if (base === null || value === null) return null;
  if (value === base) return 'same';
  return deltaOf[kind](base, value);
}

const sign = (difference: number) => (difference > 0 ? '+' : '−');

const deltaOf: Record<Row['delta'], (base: number, value: number) => string | null> = {
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
    const percent = Math.round(((value - base) / base) * 100);
    return percent === 0 ? 'same' : `${sign(percent)}${Math.abs(percent)}%`;
  },
};

function summaryOf(summaries: Summaries | undefined, item: RunComparisonItem) {
  const value = summaries?.get(item.run.id.toLowerCase());
  return value && value.availability === 'ready' ? value : null;
}

/** Whole-run figures per run with differences from the first (baseline) run. */
export function ComparisonDeltas({
  items,
  summaries,
}: {
  items: readonly RunComparisonItem[];
  summaries: Summaries | undefined;
}) {
  const values = items.map((item) => summaryOf(summaries, item));
  if (summaries === undefined) return <p role="status">Loading whole-run figures…</p>;
  if (values.every((value) => value === null))
    return <p className="compare-muted">No whole-run figures were recorded for these runs.</p>;
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
