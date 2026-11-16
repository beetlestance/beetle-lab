import type { ReadAdmission } from './admission.js';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
export function useCatalogue(run: Run, terminal: boolean, admission: ReadAdmission) {
  const api = useApi(); const client = useQueryClient();
  const {organizationId, workspaceId} = run.scope; const runId = run.id; const attemptId = run.activeAttemptId;
  const owner = useMemo(() => ({active: true, cursor: undefined as string | undefined, action: false}), [api, organizationId, workspaceId, runId, attemptId]);
  const key = queryKeys.runMetrics(organizationId, workspaceId, runId, attemptId);
  const query = useQuery({queryKey: key, queryFn: async ({signal}) => {
    await admission.whenIdle(signal);
    if (signal.aborted) throw new Error('Metric catalogue retired');
    const cursor = owner.cursor;
    const action = admission.run(async token => {
      const combined = AbortSignal.any([signal, token.signal]);
      const page = await readResult(api.listRunMetricSeries({params: {organizationId, workspaceId, runId, attemptId},
        query: {limit: 100, ...(cursor === undefined ? {} : {cursor})}, signal: combined}));
      if (!owner.active || combined.aborted || !token.current) throw new Error('Metric catalogue retired'); return page;
    });
    if (!action) throw new Error('Metric read busy');
    const abort = () => admission.retire(action.token);
    signal.addEventListener('abort', abort, {once: true});
    try {return await action.original;} finally {signal.removeEventListener('abort', abort);}

  }, refetchInterval: query => query.state.status !== 'error' && query.state.data?.availability === 'pending' ? 2000 : false,
  refetchIntervalInBackground: false});
  useEffect(() => {
    owner.active = true;
    return () => {owner.active = false; void client.cancelQueries({queryKey: key, exact: true}); client.removeQueries({queryKey: key, exact: true});};
  }, [owner, client, organizationId, workspaceId, runId, attemptId]);
  const wasTerminal = useRef(terminal); const needsTerminal = useRef(false);
  useEffect(() => {
    if (terminal && !wasTerminal.current) needsTerminal.current = true; wasTerminal.current = terminal;
    if (!needsTerminal.current || query.isPending || query.isFetching) return;
    needsTerminal.current = false;
    if (!query.isError && query.data?.availability === 'pending') void query.refetch({cancelRefetch: false});
  }, [terminal, query.isPending, query.isFetching, query.isError, query.data, query.refetch]);
  async function readPage(cursor?: string) {
    if (!owner.active || owner.action || admission.busy || client.isFetching({queryKey: key, exact: true})) return;
    owner.action = true; owner.cursor = cursor;
    try {await query.refetch({cancelRefetch: false});} finally {owner.action = false;}
  }
  return {query, readPage};
}
