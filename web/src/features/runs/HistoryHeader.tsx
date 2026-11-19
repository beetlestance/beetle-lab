import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import type { RunScope } from './types.js';

/** Workspace metadata belongs to this history read, never a cached foreign page. */
export function HistoryHeader({
  scope,
  workspaceName,
  pending,
  suiteId,
  suiteName,
}: {
  scope: RunScope;
  workspaceName: string | undefined;
  pending: boolean;
  suiteId: string | undefined;
  suiteName: string | undefined;
}) {
  return (
    <header className="history-header">
      <p className="history-eyebrow">Workspaces</p>
      <h1 className={pending ? 'history-title-loading skeleton-bar' : undefined}>
        {pending ? (
          <span className="sr-only">Loading workspace name…</span>
        ) : (
          (workspaceName ?? 'Workspace name unavailable')
        )}
      </h1>
      <span className="sr-only">Run history</span>
      {suiteId && (
        <p className="history-lede">
          History for {suiteName ?? <span className="number">suite {suiteId.slice(0, 8)}</span>}.{' '}
          <Link to={routes.runs(scope.organizationId, scope.workspaceId)}>Every suite</Link>
        </p>
      )}
    </header>
  );
}
