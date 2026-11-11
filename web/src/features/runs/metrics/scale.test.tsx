// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RunMetricPoint, RunMetricSeries, RunMetricValue } from '@beetle/contracts/api';
import { MetricChart } from './Chart.js';

afterEach(cleanup);

const series: RunMetricSeries = { ordinal: 0, metric: 'temperature', kind: 'gauge', scope: 'execute', tags: {}, unit: 'count', total: { kind: 'gauge', latest: 0, min: 0, max: 0, sourceTimeMs: 0 } };
function point(windowOrdinal: number, value: RunMetricValue, startTimeMs = windowOrdinal * 10, endTimeMs = startTimeMs + 5): RunMetricPoint {
  return { windowOrdinal, startTimeMs, endTimeMs, value };
}
function gauge(latest: number): RunMetricValue {
  return { kind: 'gauge', latest, min: latest, max: latest, sourceTimeMs: 0 };
}
function chart(points: RunMetricPoint[], selectedSeries = series) {
	return render(<MetricChart items={points} series={selectedSeries} />);
}
function dotPositions() {
  return [...document.querySelectorAll('circle.metric-dot')].map(dot => ({
    x: dot.getAttribute('cx'), y: dot.getAttribute('cy'),
  }));
}
function assertFiniteSvg() {
  for (const node of document.querySelectorAll('svg [x], svg [y], svg [cx], svg [cy]')) {
    for (const name of ['x', 'y', 'cx', 'cy']) {
      const value = node.getAttribute(name);
      if (value !== null) expect(Number.isFinite(Number(value))).toBe(true);
    }
  }
  for (const path of document.querySelectorAll('path.metric-line')) {
    expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  }
}

it('maps negative-only values between zero at top and the negative minimum at bottom', () => {
  chart([point(1, gauge(-2), 0, 10), point(2, gauge(-1), 10)]);
  expect(dotPositions()).toEqual([{ x: '40', y: '170' }, { x: '506.66666666666663', y: '100' }]);
  expect(document.querySelector('line.metric-axis')).toHaveAttribute('y1', '30');
  expect([...document.querySelectorAll('svg text')].slice(0, 2).map(el => el.textContent)).toEqual(['0.00', '-2.00']);
});

it('maps mixed values around a zero axis and uses that scale for dots and paths', () => {
  chart([point(1, gauge(-2), 0, 10), point(2, gauge(2), 10)]);
  expect(dotPositions()).toEqual([{ x: '40', y: '170' }, { x: '506.66666666666663', y: '30' }]);
  expect(document.querySelector('line.metric-axis')).toHaveAttribute('y1', '100');
  expect(document.querySelector('path.metric-line')).toHaveAttribute('d', 'M40,170 L506.66666666666663,30');
  expect([...document.querySelectorAll('svg text')].slice(0, 2).map(el => el.textContent)).toEqual(['2.00', '-2.00']);
});

it('keeps positive-only values above zero at the bottom of the plot', () => {
  chart([point(1, gauge(1), 0, 10), point(2, gauge(2), 10)]);
  expect(dotPositions()).toEqual([{ x: '40', y: '100' }, { x: '506.66666666666663', y: '30' }]);
  expect(document.querySelector('line.metric-axis')).toHaveAttribute('y1', '170');
  expect([...document.querySelectorAll('svg text')].slice(0, 2).map(el => el.textContent)).toEqual(['2.00', '0.00']);
});

it('uses a finite fallback domain for zero and all-null rate data, preserving gaps', () => {
  const zeroView = chart([point(1, gauge(0), 0, 10), point(2, gauge(0), 10)]);
  expect(dotPositions()).toEqual([{ x: '40', y: '170' }, { x: '506.66666666666663', y: '170' }]);
  expect(document.querySelector('line.metric-axis')).toHaveAttribute('y1', '170');
  expect([...document.querySelectorAll('svg text')].slice(0, 2).map(el => el.textContent)).toEqual(['1.00', '0.00']);
  zeroView.unmount();

  const rateSeries: RunMetricSeries = { ...series, kind: 'rate', unit: 'ratio', total: { kind: 'rate', ratio: null, numerator: 0, sampleCount: 0 } };
  chart([point(1, { kind: 'rate', ratio: null, numerator: 0, sampleCount: 0 }, 0),
    point(2, { kind: 'rate', ratio: null, numerator: 0, sampleCount: 0 }, 5)], rateSeries);
  expect(document.querySelectorAll('circle.metric-dot')).toHaveLength(0);
  expect(document.querySelectorAll('path.metric-line')).toHaveLength(0);
  expect(document.querySelector('[role="status"]')).toHaveTextContent('No measured values in these source windows.');
  expect(document.querySelector('svg')).not.toBeInTheDocument();
  expect(document.querySelector('summary')).toHaveTextContent('Source samples and estimate bounds');
  expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
  expect([...document.querySelectorAll('tbody td:nth-child(2)')].map(cell => cell.textContent)).toEqual(['No samples', 'No samples']);
  expect([...document.querySelectorAll('tbody td:first-child')].map(cell => cell.textContent)).toEqual(['0–5', '5–10']);
  expect([...document.querySelectorAll('tbody td:nth-child(3)')].map(cell => cell.textContent)).toEqual(['0 / 0 samples', '0 / 0 samples']);
  cleanup();

  chart([point(1, { kind: 'rate', ratio: 0, numerator: 0, sampleCount: 5 }, 0)], rateSeries);
  expect(document.querySelector('svg')).toBeInTheDocument();
  expect(document.querySelectorAll('circle.metric-dot')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')).not.toBeInTheDocument();
  expect(document.querySelector('tbody td:nth-child(2)')).toHaveTextContent('0');
  expect(document.querySelector('tbody td:nth-child(3)')).toHaveTextContent('0 / 5 samples');
  cleanup();

  chart([point(1, gauge(1), 0), point(2, { kind: 'rate', ratio: null, numerator: 0, sampleCount: 0 }, 5), point(4, gauge(2), 20)]);
  expect(document.querySelectorAll('path.metric-line')).toHaveLength(2);
  expect(document.querySelectorAll('circle.metric-dot')).toHaveLength(2);
  expect([...document.querySelectorAll('path.metric-line')].map(path => path.getAttribute('d'))).toEqual(['M40,100', 'M600,30']);
  expect(document.querySelector('[role="status"]')).not.toBeInTheDocument();
  expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(document.querySelectorAll('tbody td:nth-child(2)')[1]).toHaveTextContent('No samples');
  expect(document.querySelectorAll('tbody td:nth-child(3)')[1]).toHaveTextContent('0 / 0 samples');
  assertFiniteSvg();
  cleanup();

  chart([point(1, gauge(1), 0), point(3, gauge(2), 20)]);
  expect(document.querySelectorAll('path.metric-line')).toHaveLength(2);
  expect([...document.querySelectorAll('path.metric-line')].map(path => path.getAttribute('d'))).toEqual(['M40,100', 'M600,30']);
});

it('keeps the existing empty-items status', () => {
  chart([]);
  expect(document.querySelector('[role="status"]')).toHaveTextContent('No samples for this series in the examined source windows.');
  expect(document.querySelector('svg')).not.toBeInTheDocument();
  expect(document.querySelector('summary')).not.toBeInTheDocument();
});
