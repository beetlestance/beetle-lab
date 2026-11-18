import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { WorkspaceOverview as Snapshot } from '@beetle/contracts/api';
import { Button } from '../../components/Button.js';
import { OverviewEmpty } from './OverviewEmpty.js';
import { OverviewLoading } from './OverviewLoading.js';
import { ActivityChart } from './ActivityChart.js';
import { AgentPanel } from './AgentPanel.js';
import { clockTime, inProgress, plural } from './format.js';
import { LiveRunCard } from './LiveRunCard.js';
import { OverviewArt } from './OverviewArt.js';
import { RecentRuns } from './RecentRuns.js';
import { usePublishedInputs, useRunsFirstPage, useSuitesFirstPage, useWorkspaceOverview } from './reads.js';
import './overview.css';
import './states.css';

type Props = { organizationId: string; workspaceId: string; workspaceName: string };

/**
 * Penpot "Overview" (+ Empty, Loading). The snapshot is one scoped GET with
 * manual refresh only; suite names, p95, start time and the input count come
 * from shared first pages and stay unknown when those reads fail.
 */
export function WorkspaceOverview({ organizationId, workspaceId, workspaceName }: Props) {
  const query = useWorkspaceOverview(organizationId, workspaceId);
  if (query.isPending) return <OverviewLoading />;
  if (query.isError)
    return (
      <div role="alert" className="banner banner-danger">
        <div className="banner-body">
          <p className="banner-title">Workspace overview unavailable. Counts are unknown.</p>
        </div>
        <div className="banner-actions">
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
            Refresh overview
          </Button>
        </div>
      </div>
    );
  const snapshot = query.data;
  // A span, not a <p>: the empty state wraps its note in a paragraph already.
  const refresh = (
    <span className="overview-snapshot">
      As of <time dateTime={snapshot.generatedAt}>{clockTime(snapshot.generatedAt)}</time>.{' '}
      <button
        type="button"
        className="overview-refresh"
        disabled={query.isFetching}
        onClick={() => void query.refetch({ cancelRefetch: false })}
      >
        Refresh overview
      </button>
    </span>
  );
  if (snapshot.counts.runs === 0)
    return <OverviewEmpty organizationId={organizationId} workspaceId={workspaceId} workspaceName={workspaceName} />;
  return (
    <Overview
      organizationId={organizationId}
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      snapshot={snapshot}
      refresh={refresh}
    />
  );
}

function Overview({
  organizationId,
  workspaceId,
  workspaceName,
  snapshot,
  refresh,
}: Props & { snapshot: Snapshot; refresh: ReactNode }) {
  const heading = useId();
  const suites = useSuitesFirstPage(organizationId, workspaceId);
  const runs = useRunsFirstPage(organizationId, workspaceId);
  const inputs = usePublishedInputs(organizationId, workspaceId);
  const suiteNames = useMemo(
    () => (suites.data && !suites.isError ? new Map(suites.data.items.map((suite) => [suite.id, suite.name])) : null),
    [suites.data, suites.isError],
  );
  const runPage = runs.isError ? undefined : runs.data;
  const summaries = useMemo(
    () => (runPage ? new Map(runPage.summaries.map((summary) => [summary.runId, summary])) : null),
    [runPage],
  );
  const c = snapshot.counts;
  const running = inProgress(c);
  const live = snapshot.active.find((row) => row.state === 'active') ?? snapshot.active[0];
  const facts =
    `${plural(c.submitted24h, 'run')} submitted in the last 24 hours, ${c.failed24h.toLocaleString()} failed. ` +
    `${plural(c.suites, 'suite')}${inputs === null ? '' : `, ${plural(inputs, 'input file')} ready`}.`;
  return (
    <section className="overview" aria-labelledby={heading}>
      <div className="overview-hero">
        <div className="overview-hero-text">
          <p className="overview-eyebrow">{workspaceName}</p>
          <h1 id={heading}>{running ? `${plural(running, 'run')} in progress` : 'No runs in progress'}</h1>
          <p className="overview-lede">{facts}</p>
          {refresh}
          {live && (
            <LiveRunCard
              organizationId={organizationId}
              workspaceId={workspaceId}
              header={live}
              run={runPage?.items.find((run) => run.id === live.id)}
              suiteName={suiteNames?.get(live.suiteId)}
            />
          )}
          {snapshot.active.length > 1 && (
            <p className="overview-note">
              {snapshot.activeHasMore
                ? 'More runs are in progress than the overview lists; open Runs for all of them.'
                : `${plural(snapshot.active.length - 1, 'other run')} in progress; open Runs for the rest.`}
            </p>
          )}
        </div>
        <OverviewArt />
      </div>
      <div className="overview-grid">
        <ActivityChart buckets={snapshot.activity} />
        <RecentRuns
          organizationId={organizationId}
          workspaceId={workspaceId}
          rows={snapshot.recent}
          suiteNames={suiteNames}
          summaries={summaries}
        />
        <AgentPanel />
      </div>
    </section>
  );
}
