// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Starting } from './Phases.js';
import { liveRun, revision } from './fixtures.js';
import type { Row } from '../timeline/projection.js';
const { timeline } = vi.hoisted(() => ({ timeline: vi.fn() }));
vi.mock('../timeline/useTimeline.js', () => ({ useTimeline: timeline }));
afterEach(cleanup);
it.each(['prepare', 'execute'] as const)('marks compilation complete only after successful entry into %s', (phase) => {
  const rows: Row[] = [{ seq: 1, at: '2026-11-18T00:00:00Z', phase, kind: 'phase.started', text: 'Phase started' }];
  timeline.mockReturnValue({ data: { rows }, isError: false });
  render(<Starting run={liveRun()} revision={revision()} />);
  expect(screen.getByText('Compiled revision 4 to a k6 plan').closest('li')).toHaveClass('is-done');
  expect(screen.getByText('First metrics arrive').closest('li')).toHaveTextContent('Pending:');
});
it('does not claim compilation from a validate-finished event that can carry zero completed units', () => {
  const rows: Row[] = [
    { seq: 1, at: '2026-11-18T00:00:00Z', phase: 'validate', kind: 'phase.finished', text: 'Phase finished' },
  ];
  timeline.mockReturnValue({ data: { rows }, isError: false });
  render(<Starting run={liveRun()} revision={revision()} />);
  expect(screen.getByText('Compiled revision 4 to a k6 plan').closest('li')).toHaveClass('is-pending');
});
