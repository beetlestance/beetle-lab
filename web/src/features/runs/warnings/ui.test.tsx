// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import source from '../../../../../contracts/fixtures/valid/k6-warnings.json' with {type: 'json'};
import { captureK6Warnings } from '@beetle/contracts/k6-warnings';
import { WarningSummary } from './index.js';
afterEach(cleanup);
it('shows partial coverage without implying no warnings and explains absent guidance', () => {
  render(<WarningSummary report={captureK6Warnings({...source, native: {...source.native, coverage: 'partial'}})} cleanExit />);
  expect(screen.getByText(/may hide additional warnings/)).toBeInTheDocument();
  expect(screen.queryByText(/k6 exited cleanly/)).not.toBeInTheDocument();
  expect(screen.getByText(/requires one arrival scenario/)).toBeInTheDocument();
});
it('plans from configured peak and complete iteration evidence without changing configuration', () => {
  const report = captureK6Warnings({...source, configuration: {scenarioCount: 1,
    arrival: {executor: 'ramp-until', peakIterationsPerSecond: 20, preAllocatedVUs: 1, maxVUs: 2}},
    iteration: {estimate: 500, lower: 490, upper: 510, count: 4}});
  render(<WarningSummary report={report} />);
  expect(screen.getByText(/Planning estimate: 12 VUs/)).toHaveTextContent('Above configured maximum.');
  expect(screen.getByText(/configured peak rate, not the measured average/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Headroom (%)'), {target: {value: '0'}});
  expect(screen.getByText(/Planning estimate: 10 VUs/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Headroom (%)'), {target: {value: ''}});
  expect(screen.getByText(/Enter valid headroom/)).toBeInTheDocument(); expect(report.configuration.arrival!.maxVUs).toBe(2);
});

it.each([
  { cleanExit: true, otherWarnings: 0, expected: true },
  { cleanExit: false, otherWarnings: 0, expected: false },
  { cleanExit: true, otherWarnings: 1, expected: false },
])('requires both a clean exit and zero warnings (%o)', ({ cleanExit, otherWarnings, expected }) => {
  const report = captureK6Warnings({ ...source, native: { ...source.native, otherWarnings } });
  render(<WarningSummary report={report} cleanExit={cleanExit} />);
  expect(screen.queryByText('No warnings recorded. k6 exited cleanly.') !== null).toBe(expected);
});
