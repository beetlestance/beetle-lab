import { useEffect } from 'react';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import type { RunScope } from '../types.js';
import { useLiveMetrics } from '../live-metrics/useLiveMetrics.js';
import type { LiveState } from '../live-metrics/useLiveMetrics.js';
import type { LiveMetricReads } from '../live-metrics/read.js';

export type FeedState = LiveState;

/**
 * Owns one live-metrics polling lease (live-metrics/useLiveMetrics) and reports
 * each state to the view. Remounting it with a new key is "Retry now": the old
 * lease retires and a fresh read starts at once. Renders nothing.
 */
export function LiveFeed({
  run,
  scope,
  runId,
  enabled,
  onState,
  reads,
}: {
  run: Run;
  scope: RunScope;
  runId: string;
  enabled: boolean;
  onState: (state: FeedState) => void;
  reads?: Pick<LiveMetricReads, 'read'> | undefined;
}) {
  const allowed =
    enabled &&
    validateApi('Run', run).ok &&
    run.id.toLowerCase() === runId.toLowerCase() &&
    run.scope.organizationId.toLowerCase() === scope.organizationId.toLowerCase() &&
    run.scope.workspaceId.toLowerCase() === scope.workspaceId.toLowerCase();
  const state = useLiveMetrics(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId, attemptId: run.activeAttemptId },
    allowed,
    reads,
  );
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}
