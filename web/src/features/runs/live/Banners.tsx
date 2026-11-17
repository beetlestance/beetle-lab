import type { Run } from '@beetle/contracts/api';
import { Banner } from '../../../components/Banner.js';
import { Button } from '../../../components/Button.js';
import { LatencyRise } from './Extras.js';
import type { PlanRequest } from './plan.js';

/** Reconnecting: the feed went quiet while the run is streaming; figures stay from the last window. */
export function StallBanner({ silentMs, onRetry }: { silentMs: number; onRetry: () => void }) {
  return (
    <Banner
      tone="warning"
      title={`No word for ${Math.max(0, Math.round(silentMs / 1000))} s`}
      actions={
        <Button size="sm" onClick={onRetry}>
          Retry now
        </Button>
      }
    >
      Reconnecting to the live feed. The figures below are from the last window received.
    </Banner>
  );
}

/** The run ended while watched: hand off to the result, with the p95-rise line when there is one. */
export function EndedBanner({
  run,
  requests,
  showResult,
}: {
  run: Run;
  requests: readonly PlanRequest[];
  showResult: () => void;
}) {
  return (
    <Banner
      tone={run.state === 'errored' ? 'danger' : 'info'}
      title={`Run ${run.state}`}
      actions={
        <Button variant="primary" onClick={showResult}>
          Open result
        </Button>
      }
    >
      The result is sealed and ready to read. The figures below are the last live window this page received.
      <LatencyRise run={run} requests={requests} />
    </Banner>
  );
}
