import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Run } from '@beetle/contracts/api';
import { useLocation } from 'react-router-dom';
import { TabPanel, Tabs } from '../../../components/Tabs.js';
import type { ResultView } from '../../run-results/index.js';
import { RunArtifacts } from '../artifacts/index.js';
import { PublishedDiagnostics } from '../diagnostics/index.js';
import { RunPerformanceReport } from '../performance-report/index.js';
import type { RiseOrigin } from '../live/rise-position.js';
import { LatencyRise } from '../live/Extras.js';
import type { PlanRequest, PlanStage } from '../live/plan.js';
import { ExecutionActivity } from '../timeline/index.js';
import { RunWarnings } from '../warnings/index.js';

import { PhoneDisclosure, useResultPhone } from './PhoneDisclosure.js';

export type ReportTab = 'report' | 'activity' | 'artifacts' | 'diagnostics';
const phoneDetailHashes = ['result-report', 'result-chart-details', 'result-charts', 'result-script'];
function tabFromHash(hash: string): ReportTab | null {
  if (hash === '#result-artifacts') return 'artifacts';
  if (hash === '#result-diagnostics') return 'diagnostics';
  return hash === '#result-report' ? 'report' : null;
}
export function useReportTab() {
  const { hash } = useLocation();
  const [tab, setTab] = useState<ReportTab>(tabFromHash(hash) ?? 'report');
  useEffect(() => {
    const selected = tabFromHash(hash);
    if (selected) setTab(selected);
    const changed = () => {
      const next = tabFromHash(window.location.hash);
      if (next) setTab(next);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [hash]);
  return [tab, setTab] as const;
}

function paramsOf(run: Run) {
  return {
    organizationId: run.scope.organizationId,
    workspaceId: run.scope.workspaceId,
    runId: run.id,
    attemptId: run.activeAttemptId,
  };
}

function Report({ view }: { view: ResultView }) {
  if (view.status !== 'ready') return <Unready status={view.status} what="The performance report" />;
  const reports = view.result.artifacts.filter((artifact) => artifact.kind === 'performance-report');
  if (reports.length === 0) return <p className="result-muted">No performance report was published for this run.</p>;
  if (reports.length > 1)
    return <p role="alert">Multiple performance reports were published; this view requires one report.</p>;
  const params = paramsOf(view.run);
  return <RunPerformanceReport params={{ ...params, artifactId: reports[0]!.artifactId }} artifact={reports[0]!} />;
}

function Diagnostics({ view }: { view: ResultView }) {
  if (view.status !== 'ready') return <Unready status={view.status} what="Diagnostics" />;
  const params = paramsOf(view.run);
  const { execution } = view.result;
  const warnings = view.result.artifacts.filter((artifact) => artifact.kind === 'k6-warnings');
  return (
    <>
      <PublishedDiagnostics params={params} artifacts={view.result.artifacts} />
      {warnings.length === 0 && <p>Native warning evidence was not recorded for this run.</p>}
      {warnings.length > 1 && (
        <p role="alert">Multiple warning artifacts were published; no warning evidence selected.</p>
      )}
      {warnings.length === 1 && (
        <RunWarnings
          params={{ ...params, artifactId: warnings[0]!.artifactId }}
          artifact={warnings[0]!}
          cleanExit={execution.status === 'completed' && execution.exitCode === 0}
        />
      )}
    </>
  );
}

function Unready({ status, what }: { status: 'loading' | 'unavailable' | 'error'; what: string }) {
  if (status === 'loading') return <p role="status">Loading result details…</p>;
  if (status === 'error') return <p role="alert">Result details could not be loaded.</p>;
  return <p className="result-muted">{what} is unavailable: no engine result was published for this attempt.</p>;
}

/**
 * Report tabs of the Run result board: Report, What happened, Artifacts, Diagnostics.
 * Under 760px (Phone / Run result) the panels become lazy native disclosures; visited panels keep their state.
 */
type ReportTabsProps = {
  run: Run;
  view: ResultView;
  tab: ReportTab;
  onSelect: (tab: ReportTab) => void;
  requests?: readonly PlanRequest[];
  stages?: readonly PlanStage[];
  origin?: RiseOrigin | undefined;
  phoneTarget?: ReactNode;
  phoneExtras?: ReactNode;
  phoneNote?: ReactNode;
};

export function ReportTabs({
  run,
  view,
  tab,
  onSelect,
  requests = [],
  stages = [],
  origin,
  phoneTarget,
  phoneExtras,
  phoneNote,
}: ReportTabsProps) {
  const idBase = useId();
  const phone = useResultPhone();
  const count = view.status === 'ready' ? view.result.artifacts.length : undefined;
  const panels: Record<ReportTab, { label: string; body: ReactNode }> = {
    report: { label: 'Report', body: <Report view={view} /> },
    activity: {
      label: 'What happened',
      body: (
        <ExecutionActivity
          key={`activity:${run.id}/${run.activeAttemptId}`}
          run={run}
          terminal
          narrative={{ stages, observation: <LatencyRise run={run} requests={requests} origin={origin} explain /> }}
        />
      ),
    },
    artifacts: { label: 'Artifacts', body: <RunArtifacts run={run} terminal heading="Artifacts" /> },
    diagnostics: { label: 'Diagnostics', body: <Diagnostics view={view} /> },
  };
  const order: ReportTab[] = ['report', 'activity', 'artifacts', 'diagnostics'];
  if (phone)
    return (
      <div className="result-sections">
        <PhoneDisclosure id="result-activity" title="What happened" description="Timeline of stages and events">
          {panels.activity.body}
        </PhoneDisclosure>
        {phoneTarget}
        <PhoneDisclosure id="result-artifacts" title="Artifacts" description="Summary, metrics and logs to download">
          {panels.artifacts.body}
        </PhoneDisclosure>
        {phoneNote}
        <PhoneDisclosure id="result-diagnostics" title="Diagnostics" description="Engine and agent details">
          {panels.diagnostics.body}
        </PhoneDisclosure>
        <MoreRunDetails>
          <PhoneDisclosure id="result-report" title="Report" description="Published performance analysis">
            {panels.report.body}
          </PhoneDisclosure>
          {phoneExtras}
        </MoreRunDetails>
      </div>
    );
  return (
    <section id="result-report" className="result-section result-report" aria-label="Report">
      <span id="result-artifacts" className="result-report-anchor" aria-hidden="true" />
      <span id="result-diagnostics" className="result-report-anchor" aria-hidden="true" />
      <Tabs
        label="Run report"
        idBase={idBase}
        selected={tab}
        onSelect={onSelect}
        items={order.map((id) => ({
          id,
          label: panels[id].label,
          ...(id === 'artifacts' && count !== undefined ? { count } : {}),
        }))}
      />
      <TabPanel idBase={idBase} id={tab}>
        {panels[tab].body}
      </TabPanel>
    </section>
  );
}

function MoreRunDetails({ children }: { children: ReactNode }) {
  return (
    <PhoneDisclosure
      id="result-other-details"
      className="result-phone-more"
      hashAliases={phoneDetailHashes}
      title="More run details"
      description="Report and saved run information"
    >
      {children}
    </PhoneDisclosure>
  );
}
