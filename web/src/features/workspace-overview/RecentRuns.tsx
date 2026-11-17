import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { OverviewRun, RunHistorySummary } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { p95, runStatus, shortId, when } from './format.js';

/**
 * Recent submissions from the overview snapshot (at most 8). Suite names and p95
 * come from the shared first pages; when a run or suite is not on them the
 * label says so instead of guessing.
 */
export function RecentRuns({
  organizationId,
  workspaceId,
  rows,
  suiteNames,
  summaries,
}: {
  organizationId: string;
  workspaceId: string;
  rows: readonly OverviewRun[];
  suiteNames: ReadonlyMap<string, string> | null;
  summaries: ReadonlyMap<string, RunHistorySummary> | null;
}) {
  const heading = useId();
  return (
    <section className="overview-recent" aria-labelledby={heading}>
      <header className="overview-section-head">
        <h2 id={heading}>Recent runs</h2>
        <Link to={routes.runs(organizationId, workspaceId)}>All runs</Link>
      </header>
      {rows.length === 0 ? (
        <p className="overview-muted">No runs submitted in this workspace yet.</p>
      ) : (
        <ul role="list" className="overview-run-list">
          {rows.map((row) => {
            const status = runStatus(row.state, row.outcome);
            const live = row.state === 'active';
            const summary = summaries?.get(row.id);
            const latency = p95(summary);
            return (
              <li key={row.id}>
                <Link
                  to={routes.run(organizationId, workspaceId, row.id)}
                  aria-label={`${status.label}, ${suiteNames?.get(row.suiteId) ?? 'unknown suite'}, run ${row.id}`}
                >
                  <Status tone={status.tone}>{status.label}</Status>
                  <span className="overview-run-name">
                    {suiteNames?.get(row.suiteId) ?? <span className="overview-muted">Unknown suite</span>}{' '}
                    <span className="overview-id">{shortId(row.id)}</span>
                  </span>
                  <time dateTime={row.requestedAt} className="overview-muted">
                    {when(row.requestedAt)}
                  </time>
                  <span className="overview-run-figure">
                    {live
                      ? 'live'
                      : (latency ?? <span className="overview-muted">{summary ? 'No p95' : 'p95 unknown'}</span>)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
