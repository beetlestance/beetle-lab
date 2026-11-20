// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Milestones } from './Milestones.js';
import { StageSchedule } from './StageSchedule.js';
import type { Row } from './projection.js';
afterEach(cleanup);
const row = (seq: number, kind: Row['kind'], at = '2026-11-19T10:00:00Z'): Row => ({
  seq,
  kind,
  at,
  phase: 'execute',
  text: 'Recorded observation',
});
it('keeps source sequence across clock rollback and never invents elapsed time or milestones', () => {
  render(
    <Milestones
      rows={[row(1, 'runtime.started'), row(2, 'progress'), row(3, 'artifact.sealed', '2026-11-19T09:59:59Z')]}
    />,
  );
  const items = within(screen.getByRole('list', { name: 'Recorded run milestones' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('10:00:00');
  expect(items[1]).toHaveTextContent('09:59:59');
  expect(items[1]!.querySelector('time')).toHaveAttribute('datetime', '2026-11-19T09:59:59Z');
});
it('discloses that a retained heartbeat-only tail has no milestones, rather than synthesising start or finish', () => {
  render(<Milestones rows={[row(1, 'progress')]} />);
  expect(screen.getByText('No milestones are present in the retained activity.')).toBeVisible();
  expect(screen.queryByRole('list')).toBeNull();
});

it('keeps saved offsets, including subsecond starts, out of recorded milestones', () => {
  render(
    <>
      <StageSchedule
        stages={[
          { label: 'Ramp to 4 a second', startMs: 250, durationMs: 4750, drain: false },
          { label: 'Steady at 4 a second', startMs: 5000, durationMs: 15000, drain: false },
        ]}
      />
      <Milestones rows={[row(1, 'runtime.started')]} />
    </>,
  );
  const planned = screen.getByRole('list', { name: 'Scheduled stages' });
  expect(within(planned).getAllByRole('listitem')[0]).toHaveTextContent('00:00.25Ramp to 4 a second');
  expect(within(planned).getAllByRole('listitem')[1]).toHaveTextContent('00:05Steady at 4 a second');
  expect(screen.getByRole('list', { name: 'Recorded run milestones' })).not.toHaveTextContent('Steady');
});

it('places latency between scheduled stages using the scenario clock, including delayed scenarios', () => {
  const stages = [
    { label: 'Ramp', startMs: 5000, durationMs: 8000, drain: false },
    { label: 'Hold', startMs: 13000, durationMs: 10000, drain: false },
    { label: 'Ramp down', startMs: 23000, durationMs: 4000, drain: false },
  ];
  render(
    <StageSchedule stages={stages} scenarioStartedAtMs={10000} riseOffset={12400} latency={<p>Observed p95 rise</p>} />,
  );
  const rows = within(screen.getByRole('list', { name: 'Scenario timeline' })).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    '00:00Ramp',
    '00:08Hold',
    '00:12.4Observed p95 rise',
    '00:18Ramp down',
  ]);
});
