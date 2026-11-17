import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Organization, OrganizationOverview as Snapshot } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Status } from '../../components/Badge.js';
import { Button, buttonClass } from '../../components/Button.js';
import { clockTime, inProgress, plural, runStatus, when } from '../workspace-overview/format.js';
import '../workspace-overview/overview.css';
import './organization.css';

/** One scoped GET with manual refresh; WorkspaceList reads the same cached snapshot for its rows. */
export function useOrganizationOverview(organizationId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.organization(organizationId), 'overview'],
    queryFn: ({ signal }) => readResult(api.getOrganizationOverview({ params: { organizationId }, signal })),
  });
}

/** Penpot "Organization" hero: name, workspace and run counts, organization settings. */
export function OrganizationOverview({ organization }: { organization: Organization }) {
  const query = useOrganizationOverview(organization.id);
  const snapshot = query.isError ? undefined : query.data;
  const refresh = () => void query.refetch({ cancelRefetch: false });
  return (
    <section className="organization-hero" aria-label="Organization overview">
      <div className="overview-hero-text">
        <p className="overview-eyebrow">Organization</p>
        <h1 className="overview-title">{organization.name}</h1>
        {query.isPending && (
          <p role="status" className="overview-lede overview-muted">
            Loading organization overview…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="organization-unavailable">
            <p className="overview-lede">Organization overview unavailable. Counts are unknown.</p>
            <Button size="sm" disabled={query.isFetching} onClick={refresh}>
              Refresh organization overview
            </Button>
          </div>
        )}
        {snapshot && (
          <>
            <p className="overview-lede">{facts(snapshot)}</p>
            <p className="overview-snapshot">
              As of <time dateTime={snapshot.generatedAt}>{clockTime(snapshot.generatedAt)}</time>.{' '}
              <button type="button" className="overview-refresh" disabled={query.isFetching} onClick={refresh}>
                Refresh organization overview
              </button>
            </p>
          </>
        )}
      </div>
      <Link className={buttonClass('secondary')} to={routes.organizationSettings(organization.id)}>
        Organization settings
      </Link>
    </section>
  );
}

function facts(snapshot: Snapshot): string {
  const c = snapshot.counts;
  return (
    `${plural(snapshot.workspaces, 'workspace')}, ${inProgress(c).toLocaleString()} in progress, ` +
    `${plural(c.submitted24h, 'run')} submitted in the last 24 hours, ${c.failed24h.toLocaleString()} failed.`
  );
}

/**
 * Per-workspace figures that the organization snapshot can support honestly:
 * runs in progress from its active list and the last run from its 8 recent
 * headers. Anything the snapshot cannot prove is labelled unknown.
 */
export function WorkspaceNow({ snapshot, workspaceId }: { snapshot: Snapshot | undefined; workspaceId: string }) {
  if (!snapshot) return <span className="overview-muted">Unknown</span>;
  const running = snapshot.active.filter((row) => row.workspaceId === workspaceId).length;
  if (running === 0)
    return <span className="overview-muted">{snapshot.activeHasMore ? 'Unknown' : 'Nothing running'}</span>;
  return (
    <Status tone="running">
      {snapshot.activeHasMore ? 'At least ' : ''}
      {running.toLocaleString()} running
    </Status>
  );
}

export function WorkspaceLastRun({ snapshot, workspaceId }: { snapshot: Snapshot | undefined; workspaceId: string }) {
  if (!snapshot) return <span className="overview-muted">Unknown</span>;
  const last = snapshot.recent.find((row) => row.workspaceId === workspaceId);
  if (!last)
    return (
      <span className="overview-muted">
        {snapshot.counts.runs <= snapshot.recent.length ? 'No runs yet' : 'Not among the 8 latest'}
      </span>
    );
  const status = runStatus(last.state, last.outcome);
  return (
    <span className="organization-last-run">
      <Status tone={status.tone}>{status.label}</Status>
      <time dateTime={last.requestedAt} className="overview-muted">
        {when(last.requestedAt)}
      </time>
    </span>
  );
}
