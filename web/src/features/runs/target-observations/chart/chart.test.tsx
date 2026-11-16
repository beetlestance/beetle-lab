// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import { TargetObservationChart } from './index.js';

afterEach(cleanup);

const metric: TargetMetricName = 'rss';
const emptyValues = Object.fromEntries(targetMetricNames.map(name => [name, null])) as Record<TargetMetricName, number | null>;
function sample(observedAt: string, value: number | null, options: Partial<TargetRuntimeSample> = {}): TargetRuntimeSample {
  return { observedAt, phase: 'during', status: 'ready', reason: null, values: {...emptyValues, [metric]: value}, ...options };
}
function chart(samples: readonly TargetRuntimeSample[]) {
  return render(<TargetObservationChart samples={samples} metric={metric} />);
}
function coordinates() {
  return [...document.querySelectorAll('circle.target-observation-dot')].map(dot => [dot.getAttribute('cx'), dot.getAttribute('cy')]);
}
function assertFiniteCoordinates() {
  for (const node of document.querySelectorAll('svg [x], svg [y], svg [cx], svg [cy]')) {
    for (const name of ['x', 'y', 'cx', 'cy']) {
      const value = node.getAttribute(name);
      if (value !== null) expect(Number.isFinite(Number(value))).toBe(true);
    }
  }
  for (const path of document.querySelectorAll('path.target-observation-line')) {
    expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  }
}

it('plots measured zero and breaks paths at null and unavailable readings', () => {
  chart([
    sample('2025-01-01T00:00:00.000Z', 0),
    sample('2025-01-01T00:00:01.000Z', null),
    sample('2025-01-01T00:00:02.000Z', 2),
    sample('2025-01-01T00:00:03.000Z', 3, {status: 'unavailable', reason: 'timeout'}),
  ]);
  expect(coordinates()).toEqual([['40', '180'], ['520', '30']]);
  expect([...document.querySelectorAll('path.target-observation-line')].map(path => path.getAttribute('d'))).toEqual(['M40,180', 'M520,30']);
  expect(document.querySelector('circle title')).toHaveTextContent('2025-01-01T00:00:00.000Z · during · target-reported rss: 0');
  expect(document.querySelector('h3')).toHaveTextContent('Target-reported rss');
  assertFiniteCoordinates();
});

it('breaks paths when phase changes or observed time stops increasing', () => {
  chart([
    sample('2025-01-01T00:00:00.000Z', 1),
    sample('2025-01-01T00:00:01.000Z', 2),
    sample('2025-01-01T00:00:02.000Z', 3, {phase: 'after'}),
    sample('2025-01-01T00:00:01.500Z', 4, {phase: 'after'}),
    sample('2025-01-01T00:00:03.000Z', 5, {phase: 'after'}),
  ]);
  expect([...document.querySelectorAll('path.target-observation-line')].map(path => path.getAttribute('d'))).toEqual([
    'M40,150 L280,120', 'M520,90', 'M400,60 L760,30',
  ]);
});

it('shows an explicit empty state for all missing readings without inventing zeros', () => {
  chart([sample('2025-01-01T00:00:00.000Z', null), sample('2025-01-01T00:00:01.000Z', null, {status: 'unavailable', reason: 'http'})]);
  expect(document.querySelector('[role="status"]')).toHaveTextContent('No readings available for this metric.');
  expect(document.querySelector('svg')).not.toBeInTheDocument();
  expect(document.querySelectorAll('circle')).toHaveLength(0);
});

it('keeps near-maximum finite readings within finite SVG coordinates', () => {
  chart([sample('2025-01-01T00:00:00.000Z', Number.MAX_VALUE / 2), sample('2025-01-01T00:00:01.000Z', Number.MAX_VALUE)]);
  expect(coordinates()).toEqual([['40', '105'], ['760', '30']]);
  assertFiniteCoordinates();
});

it('keeps ordinary coordinates finite beside a leap-second timestamp and reports omitted points', () => {
  chart([sample('2016-12-31T23:59:59.000Z', 0), sample('2016-12-31T23:59:60.000Z', 100), sample('2017-01-01T00:00:01.000Z', 2)]);
  expect(document.querySelectorAll('circle')).toHaveLength(2); assertFiniteCoordinates();
  expect(document.querySelector('[role="status"]')).toHaveTextContent('cannot be plotted');
});
it('reports known values with no usable time coordinate without inventing a plot', () => {
  chart([sample('2016-12-31T23:59:60.000Z', 100)]);
  expect(document.querySelector('svg')).toBeNull(); expect(document.querySelector('[role="status"]')).toHaveTextContent('no plottable');
});
