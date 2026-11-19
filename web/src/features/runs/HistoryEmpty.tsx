import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import { useSessionAccess } from '../../app/session.js';
import { Button, buttonClass } from '../../components/Button.js';
import { EmptyState } from '../../components/States.js';
import runsArt from '../../assets/illustrations/runs.svg';
import type { RunScope } from './types.js';

export function HistoryEmpty({ scope, filtered, reset }: { scope: RunScope; filtered: boolean; reset(): void }) {
  const { readOnly } = useSessionAccess();
  if (filtered)
    return (
      <EmptyState
        compact
        title="No runs match these filters"
        actions={
          <Button size="sm" onClick={reset}>
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
          {readOnly ? (
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
        {readOnly && (
          <p className="history-empty-readonly">
            Restored history is read-only. New suites and runs cannot be created here.
          </p>
        )}
      </div>
      <img src={runsArt} width="560" height="392" alt="" />
    </section>
  );
}
