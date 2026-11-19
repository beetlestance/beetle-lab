// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Finalizing } from './Finalizing.js';
import { config, liveRun } from './fixtures.js';
import { readPlan } from './plan.js';
const { timeline } = vi.hoisted(() => ({ timeline: vi.fn() }));
vi.mock('../timeline/useTimeline.js', () => ({ useTimeline: timeline }));
afterEach(cleanup);
const props = { run: liveRun({ state: 'finalizing' }), plan: readPlan(config), figures: null, lastT: null };
it('shows an indeterminate card and unknown figures before sealing evidence arrives', () => {
  timeline.mockReturnValue({ isError: false });
  render(<Finalizing {...props} />);
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByText('Waiting for the engine report')).toBeVisible();
  expect(screen.getByText('Last live window unavailable')).toBeVisible();
  expect(screen.queryByText(/0 files sealed|Summary written|Hashing artifacts/)).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Sealing results' }).querySelectorAll('dd')).toHaveLength(4);
});
it('labels retained evidence after a read error and retries without overlapping the read', () => {
  const refetch = vi.fn();
  timeline.mockReturnValue({
    isError: true,
    isFetching: false,
    refetch,
    data: { omitted: true, rows: [{ kind: 'artifact.sealed' }, { kind: 'engine.result' }] },
  });
  render(<Finalizing {...props} lastT={316000} />);
  expect(screen.getByText('Last live window at 05:16 of 10:00')).toBeVisible();
  expect(screen.getByText('At least 1 file sealed')).toBeVisible();
  expect(
    within(screen.getByRole('list', { name: 'Last recorded sealing events' })).getByText('Engine report written'),
  ).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('last recorded events are shown');
  fireEvent.click(screen.getByRole('button', { name: 'Retry sealing events' }));
  expect(refetch).toHaveBeenCalledWith({ cancelRefetch: false });
});
it('keeps the retry unavailable while an existing sealing read settles', () => {
  timeline.mockReturnValue({ isError: true, isFetching: true, refetch: vi.fn() });
  render(<Finalizing {...props} />);
  expect(screen.getByRole('button', { name: 'Retry sealing events' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Sealing events could not be read.');
});

it('advances artifact collection and sampler closure only on recorded phase entry', () => {
  const plan = { ...props.plan, samplingIntervalMs: 1000 };
  timeline.mockReturnValue({
    isError: false,
    data: { coverage: 'contiguous', rows: [{ kind: 'phase.finished', phase: 'execute' }] },
  });
  const view = render(<Finalizing {...props} plan={plan} />);
  expect(screen.getByText('Waiting for target sampler closure')).toBeVisible();
  expect(screen.queryByText('Target sampler closed')).toBeNull();

  timeline.mockReturnValue({
    isError: false,
    data: {
      coverage: 'contiguous',
      rows: [
        { kind: 'phase.started', phase: 'collect' },
        { kind: 'artifact.sealed', artifactKind: 'performance-report' },
      ],
    },
  });
  view.rerender(<Finalizing {...props} plan={plan} />);
  expect(screen.getByText('Target sampler closed')).toBeVisible();
  expect(screen.getByText('Artifact collection started')).toHaveClass('is-active');
  expect(screen.getByText('Engine report written')).toBeVisible();
  expect(screen.queryByText(/Awaiting final confirmation/)).toBeNull();

  timeline.mockReturnValue({
    isError: true,
    data: { coverage: 'contiguous', rows: [{ kind: 'phase.started', phase: 'collect' }] },
  });
  view.rerender(<Finalizing {...props} plan={plan} />);
  expect(screen.getByText('Artifact collection started')).not.toHaveClass('is-active');

  timeline.mockReturnValue({
    isError: false,
    data: { coverage: 'contiguous', rows: [{ kind: 'phase.finished', phase: 'collect' }] },
  });
  view.rerender(<Finalizing {...props} plan={plan} />);
  expect(screen.getByText('Target sampler closed')).toBeVisible();
  expect(screen.getByText('Artifact collection complete. Awaiting final confirmation')).toBeVisible();
  expect(screen.queryByText('Engine report written')).toBeNull();
});
