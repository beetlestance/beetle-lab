import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { routes, validId } from '../../app/routes.js';
import { queryKeys } from '../../app/queries.js';
import type { RunScope } from './types.js';
import { RunHistory } from './RunHistory.js';
import { RunDetail } from './RunDetail.js';
import './runs.css';
export { RunSavedRevision } from './RunSavedRevision.js';

export function Runs(props: RunScope & { runId?: string }) {
  if (!validId(props.organizationId) || !validId(props.workspaceId)
    || (props.runId !== undefined && !validId(props.runId))) return <h1>Page not found</h1>;
  return <ScopedRuns key={`${props.organizationId}/${props.workspaceId}/${props.runId ?? ''}`} {...props} />;
}
function ScopedRuns({ organizationId, workspaceId, runId }: RunScope & { runId?: string }) {
  const client = useQueryClient();
  useEffect(() => () => {
    const queryKey = queryKeys.runs(organizationId, workspaceId);
    void client.cancelQueries({ queryKey });
    client.removeQueries({ queryKey });
  }, [client, organizationId, workspaceId]);
  const scope = { organizationId, workspaceId };
  return <section className="content-section runs-page">
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to={routes.workspace(organizationId, workspaceId)}>Workspace</Link>
      <Link to={routes.suites(organizationId, workspaceId)}>Suites</Link>
      <Link to={routes.runs(organizationId, workspaceId)}>Runs</Link>
    </nav>
    {runId ? <RunDetail {...scope} runId={runId} /> : <RunHistory {...scope} />}
  </section>;
}
