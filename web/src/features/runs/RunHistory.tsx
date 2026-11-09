import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import type { RunScope } from './types.js';

export function RunHistory(scope: RunScope) {
  const api = useApi();
  const key = queryKeys.runs(scope.organizationId, scope.workspaceId);
  const page = usePage(key);
  const query = useQuery({ queryKey: [...key, 'page', page.cursor],
    queryFn: ({ signal }) => readResult(api.listRuns({ params: scope, query: page.query, signal })) });
  return <><header className="section-header"><div><h1>Runs</h1>
    <p>Execution history for this workspace. Open a saved suite revision to submit a run.</p></div>
    <button onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh history</button></header>
    <QueryState query={query}>{data => <>
      <div className="table-scroll"><table><caption className="sr-only">Workspace run history</caption>
        <thead><tr><th>Run / saved revision</th><th>Requested</th><th>State</th><th>Outcome</th><th>Engine validation</th></tr></thead>
        <tbody>{data.items.map(run => <tr key={run.id}>
          <th scope="row"><Link className="number" to={routes.run(scope.organizationId, scope.workspaceId, run.id)}>{run.id}</Link>
            <span className="display-path number">{run.revisionId}</span></th>
          <td><time dateTime={run.requestedAt}>{run.requestedAt}</time></td><td>{run.state}</td>
          <td>{run.outcome}</td><td>{run.validationStatus}</td>
        </tr>)}</tbody></table></div>
      {!data.items.length && <p className="notice">No runs in this workspace yet.</p>}
      <Pagination page={page} next={data.nextCursor} />
    </>}</QueryState>
  </>;
}
