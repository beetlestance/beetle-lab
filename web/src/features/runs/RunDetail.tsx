import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { budgetFields } from './request.js';
import type { RunScope } from './types.js';
import { RunCancellation } from './RunCancellation.js';

export function terminal(run: Run | undefined) {
  return run !== undefined && ['finished', 'cancelled', 'errored'].includes(run.state);
}
export function RunDetail(scope: RunScope & { runId: string }) {
  const api = useApi();
  const query = useQuery({ queryKey: queryKeys.run(scope.organizationId, scope.workspaceId, scope.runId),
    queryFn: ({ signal }) => readResult(api.getRun({ params: scope, signal })),
    refetchInterval: query => terminal(query.state.data) || query.state.status === 'error' ? false : 2000,
    refetchIntervalInBackground: false });
  return <><header className="section-header"><div><h1>Run detail</h1><p className="number">{scope.runId}</p></div>
    <button onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh run</button></header>
    <QueryState query={query}>{run => <><RunCancellation run={run} /><RunSnapshot run={run} /></>}</QueryState></>;
}
function RunSnapshot({ run }: { run: Run }) {
  return <>
    <dl className="run-facts">
      <div><dt>State</dt><dd>{run.state}</dd></div><div><dt>Outcome</dt><dd>{run.outcome}</dd></div>
      <div><dt>Engine validation</dt><dd>{run.validationStatus}</dd></div>
      <div><dt>Reason</dt><dd>{run.reason ?? 'None reported'}</dd></div>
      <div><dt>Cancellation requested</dt><dd>{run.cancellationRequested ? 'Yes' : 'No'}</dd></div>
      <div><dt>Requested</dt><dd><time dateTime={run.requestedAt}>{run.requestedAt}</time></dd></div>
      <div><dt>Version</dt><dd>{run.version}</dd></div>
      <div><dt>Saved revision</dt><dd className="number">{run.revisionId}</dd></div>
      <div><dt>Revision digest</dt><dd className="number">{run.revisionDigest}</dd></div>
      <div><dt>Suite</dt><dd><Link to={routes.suite(run.scope.organizationId, run.scope.workspaceId, run.suiteId)}>{run.suiteId}</Link></dd></div>
      <div><dt>Active attempt</dt><dd className="number">{run.activeAttemptId}</dd></div>
      <div><dt>Engine / profile</dt><dd>{run.engine.id} / {run.engine.profileId}</dd></div>
      <div><dt>Image digest</dt><dd className="number">{run.engine.imageDigest}</dd></div>
      <div><dt>Execution policy</dt><dd>{run.executionPolicy.mode}; prefer idle: {run.executionPolicy.preferIdle ? 'yes' : 'no'}</dd></div>
      {budgetFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{run.budget[key]}</dd></div>)}
      <div><dt>Settings versions</dt><dd>Installation {run.settingsVersions.installation}, organization {run.settingsVersions.organization}, workspace {run.settingsVersions.workspace}</dd></div>
    </dl>
    <p className="notice">Metrics and result artifacts are unavailable in this view. State, outcome and engine validation are reported independently.</p>
    {run.outcome === 'pending' && <p role="status">The outcome is pending, including while finalization is in progress.</p>}
  </>;
}
