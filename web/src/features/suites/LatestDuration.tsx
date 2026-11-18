import type { SuiteLatestRun } from '@beetle/contracts/api';
import { useSessionAccess } from '../../app/session.js';
import { clock } from '../suite-overview/index.js';

/** Runtime elapsed and measured k6 duration are different sources, never request age. */
export function LatestDuration({ run, now }: { run: SuiteLatestRun; now: number }) {
  const { restoredBackup } = useSessionAccess();
  if (restoredBackup !== null && !['finished', 'cancelled', 'errored'].includes(run.state)) {
    return <span className="suite-subline">State at backup</span>;
  }
  if (run.state === 'active') {
    if (run.startedAt === null) return <span className="suite-subline">Start time unavailable</span>;
    const elapsed = now - Date.parse(run.startedAt);
    if (!Number.isFinite(elapsed)) return <span className="suite-subline">Start time unavailable</span>;
    return (
      <span className="suite-subline">{elapsed < 0 ? 'Start time ahead of browser' : `${clock(elapsed)} so far`}</span>
    );
  }
  if (['queued', 'dispatching'].includes(run.state)) return <span className="suite-subline">Waiting to start</span>;
  if (run.state === 'finalizing') return <span className="suite-subline">Finishing results</span>;
  return (
    <span className="suite-subline" title="Measured test duration">
      {run.testDurationMs === null ? 'Duration not recorded' : `Took ${clock(run.testDurationMs)}`}
    </span>
  );
}
