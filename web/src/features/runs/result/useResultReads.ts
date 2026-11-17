import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { resultView } from '../../run-results/index.js';

/**
 * Bounded reads for one terminal run, each under the scoped run key so leaving the
 * run removes them: engine result, the run's own history summary (one listRuns row
 * by exact ID), suite and saved revision (names and 031 stamps), and the browser
 * session (restored-history flag). None polls; the run is terminal.
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
  const suite = useQuery({
    queryKey: [...key, 'suite', run.suiteId.toLowerCase()],
    queryFn: ({ signal }) => readResult(api.getSuite({ params: { ...params, suiteId: run.suiteId }, signal })),
  });
  const revision = useQuery({
    queryKey: [...key, 'revision', run.revisionId.toLowerCase()],
    queryFn: ({ signal }) =>
      readResult(api.getSuiteRevision({ params: { ...params, revisionId: run.revisionId }, signal })),
  });
  const session = useQuery({
    queryKey: [...key, 'session'],
    queryFn: ({ signal }) => readResult(api.getBrowserSession({ signal })),
  });
  useEffect(
    () => () => {
      for (const part of ['result', 'summary', 'suite', 'revision', 'session']) {
        const queryKey = [...queryKeys.run(organizationId, workspaceId, run.id), part];
        void client.cancelQueries({ queryKey });
        client.removeQueries({ queryKey });
      }
    },
    [client, organizationId, workspaceId, run.id],
  );
  const snapshot = result.data;
  const engine = snapshot?.activeAttemptId === run.activeAttemptId ? snapshot.result : null;
  const status = result.isPending ? 'loading' : result.isError ? 'error' : engine === null ? 'unavailable' : 'ready';
  const view = resultView({ scope: run.scope, runId: run.id, run, result: engine, status });
  return {
    result: { query: result, status, view },
    summary: summary.data ?? null,
    summaryStatus: summary.isPending ? 'loading' : summary.isError ? 'error' : 'ready',
    suite: suite.data,
    revision: revision.data,
    revisionQuery: revision,
    session: session.data,
  } as const;
}
export type ResultReads = ReturnType<typeof useResultReads>;
