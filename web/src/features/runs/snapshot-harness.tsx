import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { RunSnapshot } from './RunSnapshot.js';
import { terminal } from './terminal.js';
import type { RunScope } from './types.js';

/**
 * Test harness: RunDetail's own polling run read and Refresh button around the
 * shared RunSnapshot body, independent of which phase view RunDetail dispatches
 * to. Lets result, artifact and metric composition tests cover nonterminal and
 * terminal runs without depending on the live (D) or result (E) layouts.
 */
export function SnapshotDetail(scope: RunScope & { runId: string }) {
  return <ScopedSnapshot key={`${scope.organizationId}/${scope.workspaceId}/${scope.runId}`} {...scope} />;
}
/** Same scoped lifetime as the Runs route: leaving removes the workspace's run reads. */
function ScopedSnapshot(scope: RunScope & { runId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = scope;
  useEffect(
    () => () => {
      const queryKey = queryKeys.runs(organizationId, workspaceId);
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    },
    [client, organizationId, workspaceId],
  );
  const query = useQuery({
    queryKey: queryKeys.run(scope.organizationId, scope.workspaceId, scope.runId),
    queryFn: ({ signal }) => readResult(api.getRun({ params: scope, signal })),
    refetchInterval: (query) => (terminal(query.state.data) || query.state.status === 'error' ? false : 2000),
    refetchIntervalInBackground: false,
  });
  return (
    <>
      <button onClick={() => void query.refetch()} disabled={query.isFetching}>
        Refresh run
      </button>
      {query.isError && <p role="alert">Run could not be loaded.</p>}
      {query.data && (
        <RunSnapshot
          run={query.data}
          scope={{ kind: 'workspace', organizationId: scope.organizationId, workspaceId: scope.workspaceId }}
          runId={scope.runId}
        />
      )}
    </>
  );
}
