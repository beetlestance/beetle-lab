import type { Run } from '@beetle/contracts/api';
import { Banner } from '../../../components/Banner.js';
import { Button } from '../../../components/Button.js';
import { LatencyRise } from './Extras.js';
import type { PlanRequest } from './plan.js';

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
  if (!['finished', 'cancelled', 'errored'].includes(run.state)) return null;
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
      Open the result to see what was retained. The figures below are from the last live window this page received.
      <LatencyRise run={run} requests={requests} />
    </Banner>
  );
}
