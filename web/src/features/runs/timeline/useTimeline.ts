import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { readTimeline } from './read.js';
import type { Timeline } from './projection.js';
export function useTimeline(run: Run, isTerminal: boolean) {
  const api = useApi(); const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const runId = run.id; const attemptId = run.activeAttemptId;
  const owner = useMemo(() => ({ scope: { kind: 'workspace' as const, organizationId, workspaceId },
    runId, attemptId, active: true }), [api, organizationId, workspaceId, runId, attemptId]);
  const queryKey = queryKeys.runEvents(organizationId, workspaceId, runId, attemptId);
  const [finalStarted, setFinalStarted] = useState(false);
  const query = useQuery({ queryKey,
    queryFn: ({ signal }) => readTimeline({ api, owner, signal, previous: client.getQueryData<Timeline>(queryKey) }),
    refetchInterval: query => {
      if (query.state.status === 'error') return false;
      return !isTerminal || (finalStarted && query.state.data?.backlog) ? 2000 : false;
    }, refetchIntervalInBackground: false, structuralSharing: false });
  useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      const key = queryKeys.runEvents(organizationId, workspaceId, runId, attemptId);
      void client.cancelQueries({ queryKey: key, exact: true });
      client.removeQueries({ queryKey: key, exact: true });
    };
  }, [owner, client, organizationId, workspaceId, runId, attemptId]);
  const wasTerminal = useRef(isTerminal);
  const needsFinal = useRef(false);
  useEffect(() => {
    if (isTerminal && !wasTerminal.current) needsFinal.current = true;
    wasTerminal.current = isTerminal;
    if (!needsFinal.current || query.isFetching || query.isPending) return;
    needsFinal.current = false;
    if (query.isError) return;
    setFinalStarted(true);
    void query.refetch({ cancelRefetch: false });
  }, [isTerminal, query.isFetching, query.isPending, query.isError, query.refetch]);
  // A terminal initial mount may also have a bounded backlog after bootstrap.
  useEffect(() => {
    if (isTerminal && query.isSuccess && query.data.backlog) setFinalStarted(true);
  }, [isTerminal, query.isSuccess, query.data]);
  return query;
}
