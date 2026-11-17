import type { Run, SuiteGroup } from '@beetle/contracts/api';
import type { StatusTone } from '../../components/Badge.js';

export const groupText: Record<SuiteGroup, { label: string; tone: StatusTone }> = {
  in_progress: { label: 'In progress', tone: 'running' },
  passed: { label: 'Passed', tone: 'pass' },
  failed: { label: 'Failed', tone: 'fail' },
  inconclusive: { label: 'Inconclusive', tone: 'info' },
  stopped: { label: 'Stopped', tone: 'skipped' },
  no_runs: { label: 'No runs', tone: 'neutral' },
};
/** One display label for a run's separate state and outcome. */
export function runStatus(run: Pick<Run, 'state' | 'outcome'>): { label: string; tone: StatusTone } {
  switch (run.state) {
    case 'queued':
      return { label: 'Queued', tone: 'running' };
    case 'dispatching':
      return { label: 'Starting', tone: 'running' };
    case 'active':
      return { label: 'Running', tone: 'running' };
    case 'finalizing':
      return { label: 'Finalizing', tone: 'running' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'skipped' };
    case 'errored':
      return { label: 'Errored', tone: 'fail' };
    default:
      return run.outcome === 'passed'
        ? { label: 'Passed', tone: 'pass' }
        : run.outcome === 'failed'
          ? { label: 'Failed', tone: 'fail' }
          : { label: 'Inconclusive', tone: 'info' };
  }
}
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** "Today, 23:35", "Yesterday, 21:30", "Nov 14, 11:40" (local time). */
export function when(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = time.format(date);
  if (date.getTime() >= start && date.getTime() < start + 86_400_000) return `Today, ${at}`;
  if (date.getTime() >= start - 86_400_000 && date.getTime() < start) return `Yesterday, ${at}`;
  return `${(date.getFullYear() === now.getFullYear() ? day : dayYear).format(date)}, ${at}`;
}
export function engineLabel(engineId: string | null | undefined): string {
  return engineId === 'k6' ? 'k6 load' : engineId ? engineId : 'No revision';
}
