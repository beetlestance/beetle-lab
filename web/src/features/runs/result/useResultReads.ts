import { verifiedRunRevision } from '../run-revision.js';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { liveMetricScopeMatches } from '@beetle/contracts/api';
import type { Run, RunChartHistory } from '@beetle/contracts/api';
import { ApiFailure, readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { resultView } from '../../run-results/index.js';

/**
 * Bounded reads for one terminal or restored run, each under the scoped run key so leaving the
 * run removes them: engine result, the run's own history summary (one listRuns row
 * by exact ID), and suite and saved revision (names and 031 stamps). Session access
 * comes from SessionContext. These metadata reads never poll.
 */
export function useResultReads(run: Run) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const params = { organizationId, workspaceId };
  const key = queryKeys.run(organizationId, workspaceId, run.id);
  const attempt = run.activeAttemptId.toLowerCase();
  const result = useQuery({
    queryKey: [...key, 'result', run.activeAttemptId],
    queryFn: ({ signal }) => readResult(api.getRunResult({ params: { ...params, runId: run.id }, signal })),
  });
  const summary = useQuery({
    queryKey: [...key, 'summary', attempt],
    queryFn: async ({ signal }) => {
      const page = await readResult(api.listRuns({ params, query: { limit: 1, runIdPrefix: run.id }, signal }));
      const index = page.items.findIndex((item) => item.id.toLowerCase() === run.id.toLowerCase());
      const value = index < 0 ? undefined : page.summaries[index];
      return value && value.attemptId.toLowerCase() === attempt ? value : null;
    },
  });
  const overview = useQuery({
    queryKey: [...key, 'overview', attempt],
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      readResult(
        api.getRunMetricOverview({ params: { ...params, runId: run.id, attemptId: run.activeAttemptId }, signal }),
      ),
  });
  const chartHistory = useQuery({
    queryKey: [...key, 'chart-history', attempt],
    // Let the overview settle before using the same bounded native read lane.
    enabled: !overview.isPending,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      readResult(
        api.getRunChartHistory({ params: { ...params, runId: run.id, attemptId: run.activeAttemptId }, signal }),
      ),
  });
  const stoppedHistory = useStoppedHistory(run, chartHistory);
  const suite = useQuery({
    queryKey: [...key, 'suite', run.suiteId.toLowerCase()],
    queryFn: ({ signal }) => readResult(api.getSuite({ params: { ...params, suiteId: run.suiteId }, signal })),
  });
  const revision = useQuery({
    queryKey: [...key, 'revision', run.revisionId.toLowerCase()],
    queryFn: ({ signal }) =>
      readResult(api.getSuiteRevision({ params: { ...params, revisionId: run.revisionId }, signal })),
    select: (value) => verifiedRunRevision(value, run),
  });
  useEffect(
    () => () => {
      for (const part of ['result', 'summary', 'suite', 'revision', 'overview', 'chart-history', 'stopped-history']) {
        const queryKey = [...queryKeys.run(organizationId, workspaceId, run.id), part];
        void client.cancelQueries({ queryKey });
        client.removeQueries({ queryKey });
      }
    },
    [client, organizationId, workspaceId, run.id],
  );
  const snapshot = result.data;
  const matchesAttempt = snapshot?.activeAttemptId === run.activeAttemptId;
  const engine = matchesAttempt ? snapshot.result : null;
  const status = result.isPending ? 'loading' : result.isError ? 'error' : engine === null ? 'unavailable' : 'ready';
  const view = resultView({ scope: run.scope, runId: run.id, run, result: engine, status });
  return {
    result: { query: result, status, view, matchesAttempt },
    overview,
    chartHistory,
    stoppedHistory,
    summary: summary.data ?? null,
    summaryStatus: summary.isPending ? 'loading' : summary.isError ? 'error' : 'ready',
    suite: available(suite),
    revision: available(revision),
    revisionQuery: revision,
  } as const;
}
function useStoppedHistory(run: Run, chartHistory: UseQueryResult<RunChartHistory>) {
  const api = useApi();
  const { organizationId, workspaceId } = run.scope;
  const params = { organizationId, workspaceId };
  const attempt = run.activeAttemptId.toLowerCase();
  return useQuery({
    queryKey: [...queryKeys.run(organizationId, workspaceId, run.id), 'stopped-history', attempt],
    enabled:
      (run.state === 'cancelled' || run.state === 'errored') &&
      chartHistory.isSuccess &&
      chartHistory.data.reason === 'not_recorded',
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const reply = await api.getRunStoppedHistory({
        params: { ...params, runId: run.id, attemptId: run.activeAttemptId },
        signal,
      });
      if (reply.ok) {
        if (!liveMetricScopeMatches(reply.value.scope, { ...params, attemptId: attempt, generation: 1 }))
          throw new ApiFailure({ kind: 'response' });
        return reply.value;
      }
      if (reply.error.kind === 'protocol' && reply.error.status === 404 && reply.error.protocol?.code === 'not_found')
        return null;
      throw new ApiFailure(reply.error);
    },
  });
}

export type ResultReads = ReturnType<typeof useResultReads>;

/** A failed refresh cannot continue granting a current name or revision label. */
function available<T>(query: { isError: boolean; data: T | undefined }): T | undefined {
  return query.isError ? undefined : query.data;
}
