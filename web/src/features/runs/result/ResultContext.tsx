import { RunRequester } from '../RunRequester.js';
import { Link } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { Button } from '../../../components/Button.js';
import { shortId, formatTime } from '../../run-results/format.js';
import { useLiveNamespace } from '../live/data.js';

/** Namespace metadata never mounts the current-work snapshot or gates result reads. */
export function ResultContext({
  run,
  suiteName,
  ordinal,
}: {
  run: Run;
  suiteName: string | undefined;
  ordinal: number | undefined;
}) {
  const { organizationId, workspaceId } = run.scope;
  const time = run.startedAt ?? run.requestedAt;
  return (
    <p className="result-context">
      <WorkspaceName run={run} />
      {' / '}
      <Link to={routes.runs(organizationId, workspaceId)}>Runs</Link>
      {' / '}
      {suiteName ?? 'Suite'} ({run.engine.id} load test), run <span className="number">{shortId(run.id)}</span>
      {ordinal !== undefined && `, revision ${ordinal}`}, {run.startedAt ? 'started' : 'requested'}{' '}
      <time dateTime={time}>{formatTime(time)}</time>
      {' · '}
      <RunRequester run={run} />
    </p>
  );
}

function WorkspaceName({ run }: { run: Run }) {
  const namespace = useLiveNamespace(run);
  const failed = namespace.organization.isError || namespace.workspace.isError;
  const workspace = !failed && namespace.workspace.isSuccess ? namespace.workspace.data.name : null;
  const { organizationId, workspaceId } = run.scope;
  return (
    <>
      {workspace ? (
        <Link to={routes.workspace(organizationId, workspaceId)}>{workspace}</Link>
      ) : (
        <span>{failed ? 'Workspace unavailable' : 'Reading workspace…'}</span>
      )}
      {failed && (
        <Button size="sm" variant="text" disabled={namespace.busy} onClick={namespace.retry}>
          Retry workspace name
        </Button>
      )}
    </>
  );
}
