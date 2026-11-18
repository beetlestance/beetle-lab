import { useQuery } from '@tanstack/react-query';
import type { SuiteRevision, WorkspaceScope } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { exportTerminalStates } from '../exports/prepare.js';
import { useScriptText } from './script-read.js';

/** Read-only comparison owner: never prepares a job or retries a failed lookup automatically. */
export function useSavedScript(scope: WorkspaceScope, revision: SuiteRevision | undefined) {
  const api = useApi();
  const latest = useQuery({
    queryKey: queryKeys.latestRevisionExport(scope.organizationId, scope.workspaceId, revision?.id ?? ''),
    enabled: revision !== undefined,
    queryFn: ({ signal }) => {
      if (!revision) throw new Error('No comparison revision is selected.');
      return readResult(
        api.getLatestRevisionExport({
          params: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, revisionId: revision.id },
          signal,
        }),
      );
    },
    refetchInterval: (query) =>
      query.state.status !== 'error' &&
      query.state.data?.job &&
      !exportTerminalStates.includes(query.state.data.job.state)
        ? 2000
        : false,
  });
  const job = latest.data?.job ?? undefined;
  const text = useScriptText(scope, revision, job);
  return {
    job,
    text,
    pending: latest.isPending,
    failed: latest.isError || text.isError,
    refreshing: latest.isFetching || text.isFetching,
    retry: () => {
      if (!revision) return;
      void latest.refetch({ cancelRefetch: false });
      if (text.isError) void text.refetch();
    },
  };
}
