import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OverviewRun, Run } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { buttonClass } from '../../components/Button.js';
import { clockTime, elapsed, runStatus, shortId } from './format.js';

function useNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * The newest in-progress run of the snapshot. Start time comes from the run
 * record (`startedAt`); before the engine starts there is no elapsed time.
 * Live figures and the stage plan belong to the live run page.
 */
export function LiveRunCard({
  organizationId,
  workspaceId,
  header,
  run,
  suiteName,
}: {
  organizationId: string;
  workspaceId: string;
  header: OverviewRun;
  run: Run | undefined;
  suiteName: string | undefined;
}) {
  const startedAt = run?.startedAt ?? null;
  const now = useNow(startedAt !== null);
  const status = runStatus(header.state, header.outcome);
  const path = routes.run(organizationId, workspaceId, header.id);
  return (
    <article className="overview-live" aria-label={`${status.label} run ${header.id}`}>
      <div className="overview-live-head">
        <div>
          <Status tone={status.tone}>{status.label}</Status>
          <p className="overview-live-title">
            {suiteName ?? <span className="overview-muted">Suite not on the first page</span>}{' '}
            <span className="overview-id">run {shortId(header.id)}</span>
          </p>
        </div>
        <Link className={buttonClass('primary')} to={path}>
          {header.state === 'active' ? 'Open live run' : 'Open run'}
        </Link>
      </div>
      {startedAt ? (
        <p className="overview-live-time">
          <span>{elapsed((now - Date.parse(startedAt)) / 1000)} elapsed</span>
          <span>
            Started <time dateTime={startedAt}>{clockTime(startedAt)}</time>
          </span>
        </p>
      ) : (
        <p className="overview-live-time">
          <span>
            Requested <time dateTime={header.requestedAt}>{clockTime(header.requestedAt)}</time>
            {run ? '; not started yet' : ''}
          </span>
        </p>
      )}
      <p className="overview-note">Requests a second, p95 latency and failures are on the live run page.</p>
    </article>
  );
}
