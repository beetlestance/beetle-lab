import type { Suite } from '@beetle/contracts/api';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { runStatus, when } from './status.js';
import './overview.css';
export { Overview } from './Overview.js';
export { LoadShape } from './LoadShape.js';
export { StartRun } from './StartRun.js';
export { planSummary, clock } from './plan.js';
export type { PlanSummary } from './plan.js';
export { groupText, runStatus, when, engineLabel } from './status.js';

/**
 * The suite's five most recent retained runs (one indexed suite-filtered read).
 * `ordinals` maps revision IDs to ordinals from the loaded revision page; a run
 * whose revision is not on that page shows no "rev" label rather than a guess.
 */
export function RecentRuns({ suite, ordinals }: { suite: Suite; ordinals: ReadonlyMap<string, number> }) {
  const api = useApi();
  const params = { organizationId: suite.scope.organizationId, workspaceId: suite.scope.workspaceId };
  const page = { limit: 5, order: 'newest' as const, suiteId: suite.id };
  const query = useQuery({
    queryKey: queryKeys.runsPage(params.organizationId, params.workspaceId, '', page),
    queryFn: ({ signal }) => readResult(api.listRuns({ params, query: page, signal })),
  });
  const history = `${routes.runs(params.organizationId, params.workspaceId)}?suiteId=${encodeURIComponent(suite.id)}`;
  return (
    <section aria-labelledby="suite-recent-title">
      <h2 id="suite-recent-title" className="suite-section-title">
        Recent runs
      </h2>
      {query.isPending ? (
        <p role="status" className="muted">
          Reading recent runs…
        </p>
      ) : query.isError ? (
        <p role="alert">
          Recent runs are unknown.{' '}
          <button type="button" className="btn btn-text btn-sm" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : query.data.items.length === 0 ? (
        <p className="muted">No retained runs for this suite. Earlier runs may have been removed.</p>
      ) : (
        <ul className="suite-recent">
          {query.data.items.map((run) => {
            const status = runStatus(run);
            const ordinal = ordinals.get(run.revisionId.toLowerCase());
            return (
              <li key={run.id}>
                <Link
                  to={routes.run(params.organizationId, params.workspaceId, run.id)}
                  aria-label={`${status.label} run ${run.id}`}
                >
                  <Status tone={status.tone}>{status.label}</Status>
                  <span className="muted">
                    {ordinal !== undefined && `rev ${ordinal}, `}
                    <time dateTime={run.requestedAt}>{when(run.requestedAt)}</time>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link className="suite-recent-all" to={history}>
        All runs of this suite
      </Link>
    </section>
  );
}
