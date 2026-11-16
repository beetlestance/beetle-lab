import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';

export function useArtifacts(run: Run, terminal: boolean) {
  const api = useApi(); const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const runId = run.id; const attemptId = run.activeAttemptId;
  const owner = useMemo(() => ({ active: true, cursor: undefined as string | undefined, action: false }),
    [api, organizationId, workspaceId, runId, attemptId]);
  const queryKey = queryKeys.runArtifacts(organizationId, workspaceId, runId, attemptId);
  const query = useQuery({ queryKey,
    queryFn: async ({ signal }) => {
      const cursor = owner.cursor;
      const page = await readResult(api.listRunArtifacts({ params: { organizationId, workspaceId, runId, attemptId },
        query: { limit: 100, ...(cursor === undefined ? {} : { cursor }) }, signal }));
      if (!owner.active || signal.aborted) throw new Error('Artifact read retired');
      return page;
    },
    refetchInterval: query => query.state.status !== 'error' && query.state.data?.availability === 'pending' ? 2000 : false,
    refetchIntervalInBackground: false });
  useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      const key = queryKeys.runArtifacts(organizationId, workspaceId, runId, attemptId);
      void client.cancelQueries({ queryKey: key, exact: true });
      client.removeQueries({ queryKey: key, exact: true });
    };
  }, [owner, client, organizationId, workspaceId, runId, attemptId]);
  const wasTerminal = useRef(terminal); const refreshTerminal = useRef(false);
  useEffect(() => {
    if (terminal && !wasTerminal.current) refreshTerminal.current = true;
    wasTerminal.current = terminal;
    if (!refreshTerminal.current || query.isPending || query.isFetching) return;
    refreshTerminal.current = false;
    if (!query.isError && query.data?.availability === 'pending') void query.refetch({ cancelRefetch: false });
  }, [terminal, query.isPending, query.isFetching, query.isError, query.data, query.refetch]);
  async function readPage(cursor?: string) {
    if (!owner.active || owner.action || client.isFetching({ queryKey, exact: true })) return;
    owner.action = true; owner.cursor = cursor;
    try { await query.refetch({ cancelRefetch: false }); }
    finally { owner.action = false; }
  }
  return { query, readPage };
}
