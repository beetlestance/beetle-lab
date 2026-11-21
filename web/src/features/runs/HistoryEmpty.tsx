import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import { useSessionAccess } from '../../app/session.js';
import { Button, buttonClass } from '../../components/Button.js';
import { EmptyState } from '../../components/States.js';
import runsArt from '../../assets/illustrations/runs.svg';
import type { RunScope } from './types.js';

export function HistoryEmpty({
  scope,
  filtered,
  reset,
  disabled,
}: {
  scope: RunScope;
  filtered: boolean;
  reset(): void;
  disabled: boolean;
}) {
  const { readOnly } = useSessionAccess();
  if (filtered)
    return (
      <EmptyState
        compact
        title="No runs match these filters"
        actions={
          <Button size="sm" disabled={disabled} onClick={reset}>
            Reset filters
          </Button>
        }
      >
        Search matches suite, folder and workspace names, run notes, or the start of a run ID.
      </EmptyState>
    );
  return (
    <section className="history-empty">
      <div className="history-empty-text">
        <h2>No runs yet</h2>
        <p>
          Every run you start lands here with its result, its p95 trace and a link to the revision it used. Pick two to
          four finished runs to compare them side by side.
        </p>
        <div>
          {readOnly || disabled ? (
            <Link className={buttonClass('secondary')} to={routes.suites(scope.organizationId, scope.workspaceId)}>
              Open suites
            </Link>
          ) : (
            <Link
              className={buttonClass('primary')}
              to={routes.newSuite(scope.organizationId, scope.workspaceId, 'form')}
            >
              Write a suite first
            </Link>
          )}
        </div>
        <p className="history-empty-note">
          {readOnly
            ? 'Restored history is read-only. New suites and runs cannot be created here.'
            : 'You can also paste a complete configuration as JSON once the suite exists.'}
        </p>
      </div>
      <img src={runsArt} width="560" height="392" alt="" />
    </section>
  );
}
