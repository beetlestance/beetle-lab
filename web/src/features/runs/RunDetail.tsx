import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiFailure, readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { NotFound } from '../../components/NotFound.js';
import { QueryState } from '../../components/QueryState.js';
import type { RunScope } from './types.js';
import { useCancellation } from './useCancellation.js';
import { terminal } from './terminal.js';
import type { RunSnapshotProps } from './RunSnapshot.js';
import { LiveRunView } from './live/index.js';
import { RunResultView } from './result/index.js';
import type { RefreshControl } from './result/index.js';

export { terminal };

/** A missing run is the run not-found page, not a retry banner. */
const missing = (error: unknown) =>
  error instanceof ApiFailure && (error.failure.protocol?.code === 'not_found' || error.failure.status === 404);

export function RunDetail(scope: RunScope & { runId: string }) {
  const api = useApi();
  const cancellation = useCancellation(scope);
  const query = useQuery({
    queryKey: queryKeys.run(scope.organizationId, scope.workspaceId, scope.runId),
    queryFn: ({ signal }) => readResult(api.getRun({ params: scope, signal })),
    refetchInterval: (query) => (terminal(query.state.data) || query.state.status === 'error' ? false : 2000),
    refetchIntervalInBackground: false,
  });
  const refresh = { run: () => void query.refetch(), busy: query.isFetching };
  if (missing(query.error))
    return (
      <NotFound
        kind="run"
        back={{ to: routes.runs(scope.organizationId, scope.workspaceId), label: 'Back to runs' }}
      />
    );
  return (
    <>
      {query.data === undefined && (
        // Until the run is read, this is the page title; each phase view then owns it.
        <header className="section-header">
          <div>
            <h1>Run detail</h1>
            <p className="number">{scope.runId}</p>
          </div>
          <button onClick={refresh.run} disabled={refresh.busy}>
            Refresh run
          </button>
        </header>
      )}
      <QueryState query={query}>
        {(run) => (
          <RunView
            run={run}
            scope={{ kind: 'workspace', organizationId: scope.organizationId, workspaceId: scope.workspaceId }}
            runId={scope.runId}
            cancel={cancellation}
            refresh={refresh}
          />
        )}
      </QueryState>
    </>
  );
}

/**
 * State dispatcher. The phase is chosen when the run first renders: a nonterminal run
 * opens the live view, a terminal run the result view. A run that ends while
 * watched stays in the live view (which then shows the terminal state) until the
 * live view calls `showResult`; switching remounts and re-reads, so the live view
 * owns that hand-off. The live header owns the h1 and Cancel; the result header owns
 * the h1 and Refresh run. Terminal runs get no cancellation control.
 */
function RunView({
  cancel,
  refresh,
  ...props
}: RunSnapshotProps & { cancel: ReturnType<typeof useCancellation>; refresh: RefreshControl }) {
  const [phase, setPhase] = useState<'live' | 'result'>(() => (terminal(props.run) ? 'result' : 'live'));
  return phase === 'result' ? (
    <RunResultView {...props} refresh={refresh} />
  ) : (
    <LiveRunView {...props} cancel={cancel} showResult={() => setPhase('result')} />
  );
}
