import { Link } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { RetentionControls } from '../retention/index.js';
import { budgetFields } from '../execution-request/index.js';
import { RunLiveMetrics } from './live-metrics/index.js';
import { RunMetrics } from './metrics/index.js';
import { RunReads } from './RunReads.js';
import { RunArtifacts } from './artifacts/index.js';
import { ExecutionActivity } from './timeline/index.js';
import { RunResultRead } from './RunResultRead.js';
import { terminal } from './terminal.js';

export type RunSnapshotProps = { run: Run; scope: Run['scope']; runId: string };

/**
 * The pre-redesign run body shared by the live and result views. Wave 1 packages
 * D (live/) and E (result/) replace their use of it with their own layouts.
 */
export function RunSnapshot({ run, scope, runId }: RunSnapshotProps) {
  return (
    <RunReads key={`${scope.organizationId}/${scope.workspaceId}/${runId}/${run.activeAttemptId}`}>
      {terminal(run) && run.outcome !== 'pending' && (
        <RetentionControls key={`${runId}/${run.version}`} scope={scope} run={{ id: runId, version: run.version }} />
      )}
      <dl className="run-facts">
        <RunLifecycleFacts run={run} />
        <RunExecutionFacts run={run} />
      </dl>
      <ExecutionActivity
        key={`activity:${scope.organizationId}/${scope.workspaceId}/${runId}/${run.activeAttemptId}`}
        run={run}
        terminal={terminal(run)}
      />
      <RunResultRead
        key={`result:${scope.organizationId}/${scope.workspaceId}/${runId}/${run.activeAttemptId}`}
        scope={scope}
        runId={runId}
        run={run}
        terminal={terminal(run)}
      />
      {run.state === 'active' ? (
        <RunLiveMetrics run={run} scope={scope} runId={runId} />
      ) : (
        <RunMetrics run={{ ...run, scope, id: runId }} terminal={terminal(run)} />
      )}
      <RunArtifacts run={{ ...run, scope, id: runId }} terminal={terminal(run)} />
      {run.outcome === 'pending' && (
        <p role="status">The outcome is pending, including while finalization is in progress.</p>
      )}
    </RunReads>
  );
}

function RunLifecycleFacts({ run }: { run: Run }) {
  return (
    <>
      <div>
        <dt>State</dt>
        <dd>{run.state}</dd>
      </div>
      <div>
        <dt>Outcome</dt>
        <dd>{run.outcome}</dd>
      </div>
      <div>
        <dt>Engine validation</dt>
        <dd>{run.validationStatus}</dd>
      </div>
      <div>
        <dt>Reason</dt>
        <dd>{run.reason ?? 'None reported'}</dd>
      </div>
      <div>
        <dt>Cancellation requested</dt>
        <dd>{run.cancellationRequested ? 'Yes' : 'No'}</dd>
      </div>
      <div>
        <dt>Requested</dt>
        <dd>
          <time dateTime={run.requestedAt}>{run.requestedAt}</time>
        </dd>
      </div>
    </>
  );
}
function RunExecutionFacts({ run }: { run: Run }) {
  return (
    <>
      <div>
        <dt>Version</dt>
        <dd>{run.version}</dd>
      </div>
      <div>
        <dt>Saved revision</dt>
        <dd className="number">{run.revisionId}</dd>
      </div>
      <div>
        <dt>Revision digest</dt>
        <dd className="number">{run.revisionDigest}</dd>
      </div>
      <div>
        <dt>Suite</dt>
        <dd>
          <Link to={routes.suite(run.scope.organizationId, run.scope.workspaceId, run.suiteId)}>{run.suiteId}</Link>
        </dd>
      </div>
      <div>
        <dt>Active attempt</dt>
        <dd className="number">{run.activeAttemptId}</dd>
      </div>
      <div>
        <dt>Engine / profile</dt>
        <dd>
          {run.engine.id} / {run.engine.profileId}
        </dd>
      </div>
      <div>
        <dt>Image digest</dt>
        <dd className="number">{run.engine.imageDigest}</dd>
      </div>
      <div>
        <dt>Execution policy</dt>
        <dd>
          {run.executionPolicy.mode}; prefer idle: {run.executionPolicy.preferIdle ? 'yes' : 'no'}
        </dd>
      </div>
      {budgetFields.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{run.budget[key]}</dd>
        </div>
      ))}
      <div>
        <dt>Settings versions</dt>
        <dd>
          Installation {run.settingsVersions.installation}, organization {run.settingsVersions.organization}, workspace{' '}
          {run.settingsVersions.workspace}
        </dd>
      </div>
    </>
  );
}
