import {validateApi} from '@beetle/contracts/api';
import { HistorySummaryCells } from './HistorySummaryCells.js';
import { HistoryFilters } from './HistoryFilters.js';
import type { HistoryFilter } from './HistoryFilters.js';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link,useLocation } from 'react-router-dom';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { Pagination, usePage } from '../../components/Pagination.js';
import { terminal } from './RunDetail.js';
import type { RunScope } from './types.js';

export function RunHistory(scope: RunScope) {
  const {search}=useLocation();if(search.length>2048)return <p role="alert">Invalid history context.</p>;
  const ids=new URLSearchParams(search).getAll('suiteId');
  if(ids.length>1||(ids.length===1&&!validateApi('Uuid',ids[0]).ok))return <p role="alert">Invalid suite history context.</p>;
  const suiteId=ids[0]?.toLowerCase();
  return <HistoryContext key={JSON.stringify([scope,suiteId])} scope={scope} {...(suiteId?{suiteId}:{})} />;
}
function HistoryContext({ scope,suiteId }: { scope: RunScope;suiteId?:string }) {
  const [context, setContext] = useState({ filters: { order: 'newest',...(suiteId?{suiteId}:{}) } as HistoryFilter, epoch: 0 });
  function apply(filters: HistoryFilter) { setContext(previous => ({ filters:{...filters,...(suiteId?{suiteId}:{})}, epoch: previous.epoch + 1 })); }
  return <>{suiteId&&<p>History for suite <span className="number">{suiteId}</span>. <Link to={routes.runs(scope.organizationId,scope.workspaceId)}>All workspace history</Link></p>}<HistoryFilters applied={context.filters} apply={apply} />
    <HistoryPage key={context.epoch} scope={scope} filters={context.filters} /></>;
}
function HistoryPage({ scope, filters }: { scope: RunScope; filters: HistoryFilter }) {
  const api = useApi();
  const owner = useMemo(() => ({}), [api, scope.organizationId, scope.workspaceId]);
  const [selection, setSelection] = useState({owner, ids: [] as string[]});
  const selected = selection.owner === owner ? selection.ids : [];
  function setSelected(value: string[] | ((previous: string[]) => string[])) {setSelection({owner, ids: typeof value === 'function' ? value(selected) : value});}
  function toggle(id: string) {setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : previous.length < 4 ? [...previous, id] : previous);}
  const key = queryKeys.runs(scope.organizationId, scope.workspaceId);
  const page = usePage(key);
  const applied = { ...page.query, ...filters };
  const query = useQuery({ queryKey: queryKeys.runsPage(scope.organizationId,scope.workspaceId,page.cursor,applied),
    queryFn: ({ signal }) => readResult(api.listRuns({ params: scope, query: applied, signal })) });
  function refresh() { if (page.cursor) page.reset(); else void query.refetch(); }
  return <><header className="section-header"><div><h1>Runs</h1>
    <p>Execution history for this workspace. Open a saved suite revision to submit a run.</p></div>
    <button onClick={refresh} disabled={query.isFetching}>Refresh history</button></header>
    <p>Select two to four completed runs; the first selected run is the baseline. {selected.length} selected.</p>
    {selected.length >= 2 && <Link to={routes.comparison(scope.organizationId, scope.workspaceId, selected)}>Compare selected runs</Link>}
    {selected.length > 0 && <button onClick={() => setSelected([])}>Clear selection</button>}
    <QueryState query={query}>{data => <>
      <div className="table-scroll"><table><caption className="sr-only">Workspace run history</caption>
        <thead><tr><th>Select</th><th>Run / saved revision</th><th>Requested</th><th>State</th><th>Outcome</th><th>Engine validation</th><th>k6 test duration</th><th>HTTP requests</th><th>HTTP RPS</th><th>HTTP p95</th><th>HTTP failures</th><th>Published artifacts</th><th>Retained allowance</th></tr></thead>
        <tbody>{data.items.map((run, index) => <tr key={run.id}>
          <td><input type="checkbox" aria-label={`Compare ${run.id}`} checked={selected.includes(run.id)} disabled={!terminal(run) || (!selected.includes(run.id) && selected.length >= 4)} onChange={() => toggle(run.id)} /></td>
          <th scope="row"><Link className="number" to={routes.run(scope.organizationId, scope.workspaceId, run.id)}>{run.id}</Link>
            <span className="display-path number">{run.revisionId}</span></th>
          <td><time dateTime={run.requestedAt}>{run.requestedAt}</time></td><td>{run.state}</td>
          <td>{run.outcome}</td><td>{run.validationStatus}</td><HistorySummaryCells value={data.summaries[index]!} />
        </tr>)}</tbody></table></div>
      {!data.items.length && <p className="notice">No runs match this history query.</p>}
      <Pagination page={page} next={data.nextCursor} />
    </>}</QueryState>
  </>;
}
