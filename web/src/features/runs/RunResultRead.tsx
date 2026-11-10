import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { RunResultPanel } from '../run-results/index.js';

/** Keyed by requested namespace/run and authoritative attempt in RunDetail. */
export function RunResultRead({ scope, runId, run, terminal }: {
  scope: Run['scope']; runId: string; run: Run; terminal: boolean;
}) {
  const api = useApi(); const client = useQueryClient();
  const { organizationId, workspaceId } = scope;
  const { activeAttemptId } = run;
  const queryKey = [...queryKeys.run(organizationId, workspaceId, runId), 'result', activeAttemptId];
  const query = useQuery({ queryKey,
    queryFn: ({ signal }) => readResult(api.getRunResult({ params: { organizationId, workspaceId, runId }, signal })),
    refetchInterval: query => terminal || query.state.status === 'error' ? false : 2000,
    refetchIntervalInBackground: false });
  useEffect(() => () => {
    const queryKey = [...queryKeys.run(organizationId, workspaceId, runId), 'result', activeAttemptId];
    void client.cancelQueries({ queryKey, exact: true });
    client.removeQueries({ queryKey, exact: true });
  }, [client, organizationId, workspaceId, runId, activeAttemptId]);
  const wasTerminal = useRef(terminal);
  const terminalRefresh = useRef(false);
  useEffect(() => {
    // An older null request can finish after the Run becomes terminal. Wait for
    // that original, then recheck once; terminal polling has already stopped.
    if (terminal && !wasTerminal.current) terminalRefresh.current = true;
    wasTerminal.current = terminal;
    if (!terminal || !terminalRefresh.current || query.isPending || query.isFetching) return;
    terminalRefresh.current = false;
    if (!query.isError && query.data?.result === null) void query.refetch();
  }, [terminal, query.data, query.isPending, query.isFetching, query.isError, query.refetch]);
  const snapshot = query.data;
  const result = snapshot?.activeAttemptId === activeAttemptId ? snapshot.result : null;
  const status = query.isPending ? 'loading' : query.isError ? 'error' : result === null ? 'unavailable' : 'ready';
  return <RunResultPanel scope={scope} runId={runId} run={run} result={result} status={status} />;
}
