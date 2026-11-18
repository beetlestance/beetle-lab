import { useMemo, useState } from 'react';
import type { Run } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { useRevision } from '../runs/live/data.js';
import { liveFigures } from '../runs/live/model.js';
import { readPlan } from '../runs/live/plan.js';
import { Progress } from '../runs/live/Progress.js';
import { useLiveMetrics } from '../runs/live-metrics/useLiveMetrics.js';
import '../runs/live/live.css';

/** Reuses live-view validation and arithmetic while retaining only one window. */
export function LiveProgress({ run, now }: { run: Run; now: number }) {
  const revision = useRevision(run);
  const [epoch, setEpoch] = useState(0);
  if (revision.isError)
    return (
      <div className="overview-live-unavailable">
        <p>Run setup unavailable. Phase progress and live figures are unknown.</p>
        <Button
          size="sm"
          disabled={revision.isFetching}
          onClick={() => void revision.refetch({ cancelRefetch: false })}
        >
          Retry run setup
        </Button>
      </div>
    );
  return (
    <LatestProgress
      key={`${run.activeAttemptId}/${epoch}`}
      run={run}
      now={now}
      config={revision.data?.config}
      planReady={!revision.isPending}
      retry={() => setEpoch((value) => value + 1)}
    />
  );
}
function LatestProgress({
  run,
  now,
  config,
  planReady,
  retry,
}: {
  run: Run;
  now: number;
  config: unknown;
  planReady: boolean;
  retry: () => void;
}) {
  const plan = useMemo(() => readPlan(config), [config]);
  const source = useLiveMetrics(
    {
      organizationId: run.scope.organizationId,
      workspaceId: run.scope.workspaceId,
      runId: run.id,
      attemptId: run.activeAttemptId,
    },
    run.state === 'active' && !run.cancellationRequested && planReady,
  );
  const figures = useMemo(
    () => (source.status === 'ready' ? liveFigures(source.value.frame, plan) : null),
    [source, plan],
  );
  const origin = typeof run.startedAt === 'string' ? Date.parse(run.startedAt) : null;
  const elapsedMs = origin === null ? null : Math.max(0, now - origin);
  const missing = source.status === 'unavailable' || source.status === 'stale';
  return (
    <>
      <Progress
        compact
        plan={plan}
        elapsedMs={elapsedMs}
        originMs={origin}
        figures={figures}
        p95Limit={null}
        failedLimit={null}
      />
      {missing && (
        <div className="overview-live-unavailable" role="status">
          <p>
            {source.status === 'stale' ? 'The live window expired.' : 'Live metrics unavailable.'} Figures are unknown.
          </p>
          <Button size="sm" onClick={retry}>
            Retry live metrics
          </Button>
        </div>
      )}
    </>
  );
}
