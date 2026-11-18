import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OverviewRun } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { Button, buttonClass } from '../../components/Button.js';
import { clockTime, runStatus, shortId } from './format.js';

import { LiveProgress } from './LiveProgress.js';
import { useFeaturedSuite, useOverviewRun } from './reads.js';
import './live-card.css';

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
 * The featured run and its live window are refreshed independently of the aggregate snapshot.
 */
export function LiveRunCard({
  organizationId,
  workspaceId,
  header,
  suiteName,
}: {
  organizationId: string;
  workspaceId: string;
  header: OverviewRun;
  suiteName: string | undefined;
}) {
  const query = useOverviewRun(organizationId, workspaceId, header.id);
  const suite = useFeaturedSuite(organizationId, workspaceId, header.suiteId);
  const name = suite.isError ? suiteName : (suite.data?.name ?? suiteName);
  const current = query.isError ? undefined : query.data;
  const observed = current ?? header;
  const now = useNow(current?.state === 'active');
  const status = query.isError
    ? { label: 'Status unknown', tone: 'neutral' as const }
    : runStatus(observed.state, observed.outcome);
  const path = routes.run(organizationId, workspaceId, header.id);
  return (
    <article className="overview-live" aria-label={`${status.label} run ${header.id}`}>
      <div className="overview-live-head">
        <div>
          <Status tone={status.tone}>{status.label}</Status>
          <p className="overview-live-title">
            {name ?? <span className="overview-muted">Suite name unavailable</span>}{' '}
            <span className="overview-id">run {shortId(header.id)}</span>
          </p>
        </div>
        <Link className={buttonClass('primary')} to={path}>
          {observed.state === 'active' ? 'Open live run' : 'Open run'}
        </Link>
      </div>
      <LiveCardBody query={query} header={header} now={now} />
    </article>
  );
}

function LiveCardBody({
  query,
  header,
  now,
}: {
  query: ReturnType<typeof useOverviewRun>;
  header: OverviewRun;
  now: number;
}) {
  const current = query.isError ? undefined : query.data;
  const status = current ? runStatus(current.state, current.outcome).label : 'unknown';
  if (query.isError)
    return (
      <div className="overview-live-unavailable" role="status">
        <p>Run status unavailable. Progress and live figures are unknown.</p>
        <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
          Retry run status
        </Button>
      </div>
    );
  if (current?.state === 'active') return <LiveProgress key={current.activeAttemptId} run={current} now={now} />;
  if (current)
    return <p className="overview-note">The run is {status.toLowerCase()}. Open it for its latest details.</p>;
  return (
    <p className="overview-live-time">
      Requested <time dateTime={header.requestedAt}>{clockTime(header.requestedAt)}</time>. Checking run status…
    </p>
  );
}
