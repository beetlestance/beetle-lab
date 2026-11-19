import { PhoneDisclosure, useResultPhone } from './PhoneDisclosure.js';
import { ResultSectionNav } from './SectionNav.js';
import type { Section } from './SectionNav.js';
import { measurementOrigin } from '../live/rise-position.js';
import { useState } from 'react';
import { TargetHeader, usePhaseMode } from './TargetHeader.js';
import type { EngineResult } from '@beetle/contracts';
import type { Run, RunMetricOverview } from '@beetle/contracts/api';
import { Banner } from '../../../components/Banner.js';
import { useSessionAccess } from '../../../app/session.js';
import { Button } from '../../../components/Button.js';
import { formatTime } from '../../run-results/format.js';
import { RecordedWhole, RecordedMetrics, AdvancedMetrics, useRecordedCharts } from './RecordedCharts.js';
import { RunReads } from '../RunReads.js';
import type { RunSnapshotProps } from '../RunSnapshot.js';
import { ResultTargetReport } from './TargetReport.js';
import { DeleteRun } from './DeleteRun.js';
import { headline, variantOf } from './headline.js';
import type { Variant } from './headline.js';
import { ReportTabs, useReportTab } from './ReportTabs.js';
import type { ReportTab } from './ReportTabs.js';
import { ResultHeader } from './ResultHeader.js';
import { resultLayout } from './result-layout.js';
import { ScriptVersion, Thresholds } from './Sections.js';
import { ResultEndpoints, readyOverview } from './Overview.js';
import type { RunPlan } from '../live/plan.js';
import { readPlan } from '../live/plan.js';
import { useResultReads } from './useResultReads.js';
import { ResultSummary } from './Summary.js';
import {
  RecoveredHistory,
  recoveredHistoryState,
  resultSections,
  stoppedMeasurementsAbsent,
  stoppedResultUnavailable,
} from './RecoveredHistory.js';
import { ResultReadProblem } from './ResultReadProblem.js';
import type { ResultReads } from './useResultReads.js';
import './result.css';
import './phone.css';

/** RunDetail's run re-read, shown as Refresh run beside the result title. */
export type RefreshControl = { readonly run: () => void; readonly busy: boolean };

export function RunResultView({ run, scope, runId, refresh }: RunSnapshotProps & { refresh?: RefreshControl }) {
  return (
    <RunReads key={`${scope.organizationId}/${scope.workspaceId}/${runId}/${run.activeAttemptId}`}>
      <ResultBody run={{ ...run, scope, id: runId }} refresh={refresh} />
    </RunReads>
  );
}

const sectionTabs: Partial<Record<Section, ReportTab>> = {
  report: 'report',
  artifacts: 'artifacts',
  diagnostics: 'diagnostics',
};

function useSectionTab() {
  const [tab, setTab] = useReportTab();
  function selectSection(section: Section) {
    const selected = sectionTabs[section];
    if (selected) setTab(selected);
  }
  return { tab, setTab, selectSection };
}

function ResultBody({ run, refresh }: { run: Run; refresh: RefreshControl | undefined }) {
  const reads = useResultReads(run);
  const phone = useResultPhone();
  const { phaseView, className, togglePhases } = usePhaseMode();
  const { tab, setTab, selectSection } = useSectionTab();
  const [deleting, setDeleting] = useState(false);
  const { readOnly, restoredBackup: restored } = useSessionAccess();
  const view = reads.result.view;
  const ready = readyOverview(reads.overview);
  const engine = view.status === 'ready' ? view.result : null;
  const archiveMissing = incompleteArchiveMissing(run, reads, engine);
  const plan = readPlan(reads.revision?.config);
  const charts = useRecordedCharts(reads.chartHistory, plan.totalMs, run.state);
  const { showTarget, recordedTarget, nativeLayout, beforeNote, afterNote } = resultLayout({
    run,
    engine,
    phone,
    readOnly,
    phaseView,
    samplingIntervalMs: plan.samplingIntervalMs,
  });
  const sections = resultSections(reads, showTarget, recordedTarget);
  const context = { readOnly, rules: plan.rules, measurements: ready, phone };
  const { title, sentence } = headline(run, reads.suite?.name, reads.summary, engine, context);
  return (
    <div className={className} data-native-summary={nativeLayout}>
      {restored && (
        <div className="result-restored">
          <RestoredBanner createdAt={restored.createdAt} />
        </div>
      )}
      <ResultHeader
        run={run}
        title={title}
        sentence={sentence}
        readOnly={readOnly}
        phone={phone}
        ordinal={reads.revision?.ordinal}
        suiteName={reads.suite?.name}
        onDelete={() => setDeleting(true)}
        refresh={refresh}
      />
      <ResultReadProblem read={reads.result} />
      {beforeNote}
      {!phone && (
        <ResultSectionNav
          onSelect={selectSection}
          archiveMissing={archiveMissing}
          recoveredCharts={sections.recoveredCharts}
          hideTarget={sections.hideTarget}
        />
      )}
      <ResultSummary reads={reads} charts={charts} ready={ready} phone={phone} archiveMissing={archiveMissing} />
      <ResultMeasurements
        reads={reads}
        run={run}
        engine={engine}
        charts={charts}
        plan={plan}
        overview={ready}
        phone={phone}
        archiveMissing={archiveMissing}
        recoveredTarget={sections.recoveredTarget}
      />
      <SupplementaryResult
        target={{ run, engine, status: view.status, charts, plan, phaseView, togglePhases }}
        reads={reads}
        overview={ready}
        phone={phone}
        archiveMissing={archiveMissing}
        tab={tab}
        showTarget={sections.sealedTarget}
        onSelect={setTab}
      />
      {afterNote}
      {deleting && !readOnly && <DeleteRun run={run} onClose={() => setDeleting(false)} />}
    </div>
  );
}

function ResultMeasurements({
  reads,
  run,
  engine,
  charts,
  plan,
  overview,
  phone,
  archiveMissing,
  recoveredTarget,
}: {
  reads: ResultReads;
  run: Run;
  engine: EngineResult | null;
  charts: ReturnType<typeof useRecordedCharts>;
  plan: RunPlan;
  overview: RunMetricOverview | null;
  phone: boolean;
  archiveMissing: boolean;
  recoveredTarget: boolean;
}) {
  const recovered = recoveredHistoryState(reads);
  return (
    <>
      {recovered && <RecoveredHistory query={recovered} plan={plan} phone={phone} showTarget={recoveredTarget} />}
      {!archiveMissing && !recovered && (
        <RecordedWhole view={charts} p95Limit={recordedLimit(plan)} plan={plan} phone={phone} />
      )}
      <div className="result-split">
        <ThresholdSection reads={reads} engine={engine} variant={variantOf(run)} />
        {!phone && (
          <ScriptVersion run={run} suite={reads.suite} revision={reads.revision} failed={reads.revisionQuery.isError} />
        )}
      </div>
      {archiveMissing ? (
        <p className="result-muted">
          {recovered ? 'Endpoint detail requires' : 'Charts and endpoint detail require'} a verified metrics archive.
          Diagnostics and published artifacts remain available below.
        </p>
      ) : (
        <ResultEndpoints overview={overview} requests={plan.requests} phone={phone} />
      )}
    </>
  );
}

function incompleteArchiveMissing(run: Run, reads: ResultReads, engine: EngineResult | null): boolean {
  if (run.reason !== 'artifact_incomplete') return false;
  if (engine?.nativeOverview) return true;
  return (
    reads.chartHistory.isSuccess &&
    reads.chartHistory.data.reason === 'not_recorded' &&
    reads.overview.isSuccess &&
    reads.overview.data.availability === 'not_recorded'
  );
}

function RestoredBanner({ createdAt }: { createdAt: string }) {
  return (
    <Banner tone="history" title={`You are looking at a restored backup from ${formatTime(createdAt)}`} live={false}>
      Read-only. Nothing here can be started, changed, pinned or deleted.
    </Banner>
  );
}

function ThresholdSection({
  reads,
  engine,
  variant,
}: {
  reads: ResultReads;
  engine: EngineResult | null;
  variant: Variant;
}) {
  const status = reads.result.view.status;
  return (
    <section id="result-thresholds" className="result-section" aria-labelledby="result-thresholds-title">
      <h2 id="result-thresholds-title" className="result-section-title">
        Thresholds
      </h2>
      <Thresholds result={engine} status={status} variant={variant} rules={readPlan(reads.revision?.config).rules} />
      {status === 'unavailable' && !stoppedResultUnavailable(reads) && (
        <Button size="sm" variant="text" onClick={() => void reads.result.query.refetch()}>
          Check for the result again
        </Button>
      )}
    </section>
  );
}

/** Exactly one published target-runtime report is shown; none or several are said plainly. */
function TargetRuntime({
  run,
  engine,
  status,
  charts,
  plan,
  phaseView,
  togglePhases,
}: {
  run: Run;
  engine: EngineResult | null;
  status: ResultReads['result']['view']['status'];
  charts: ReturnType<typeof useRecordedCharts>;
  plan: RunPlan;
  phaseView: boolean;
  togglePhases: () => void;
}) {
  const targets = engine ? engine.artifacts.filter((artifact) => artifact.kind === 'target-runtime') : [];
  return (
    <section id="result-target" className="result-section" aria-labelledby="result-target-title">
      <TargetHeader plan={plan} phaseView={phaseView} togglePhases={togglePhases} canCompare={targets.length === 1} />
      {targets.length === 0 && (
        <p className="result-muted">
          {engine
            ? 'No target-runtime report was published for this run.'
            : status === 'loading'
              ? 'Reading the recorded result…'
              : 'Target-runtime report is unavailable.'}
        </p>
      )}
      {targets.length > 1 && (
        <p role="alert">Multiple target observation reports were published; this view requires one report.</p>
      )}
      {targets.length === 1 && (
        <ResultTargetReport
          params={{
            organizationId: run.scope.organizationId,
            workspaceId: run.scope.workspaceId,
            runId: run.id,
            attemptId: run.activeAttemptId,
            artifactId: targets[0]!.artifactId,
          }}
          artifact={targets[0]!}
          phaseView={phaseView}
          nativeOrigin={charts.data?.source?.measurementSourceTimeMs ?? null}
          hover={charts.hover}
        />
      )}
    </section>
  );
}

function recordedLimit(plan: RunPlan): number | null {
  const rules = plan.rules.filter((rule) => rule.metric === 'http_req_duration' && rule.stat === 'p95');
  const first = rules[0];
  return first && rules.every((rule) => rule.value === first.value) ? first.value : null;
}

function SupplementaryResult({
  target,
  reads,
  overview,
  phone,
  archiveMissing,
  tab,
  showTarget,
  onSelect,
}: {
  target: Parameters<typeof TargetRuntime>[0];
  reads: ResultReads;
  overview: RunMetricOverview | null;
  phone: boolean;
  archiveMissing: boolean;
  tab: ReportTab;
  showTarget: boolean;
  onSelect: (tab: ReportTab) => void;
}) {
  const { run, charts, plan } = target;
  const showCharts = !archiveMissing && !recoveredHistoryState(reads) && !stoppedMeasurementsAbsent(reads);
  return (
    <>
      {!phone && (
        <>
          {showCharts && (
            <>
              <RecordedMetrics view={charts} p95Limit={recordedLimit(plan)} />
              <AdvancedMetrics run={run} />
            </>
          )}
          {showTarget && <TargetRuntime {...target} />}
        </>
      )}
      <ReportTabs
        run={run}
        view={reads.result.view}
        tab={tab}
        onSelect={onSelect}
        requests={plan.requests}
        origin={measurementOrigin(overview)}
        phoneTarget={
          showTarget && (
            <PhoneDisclosure
              id="result-target-details"
              expanded={target.phaseView}
              hashId="result-target"
              title="Target runtime"
              description="Heap, RSS, CPU and event-loop delay by phase"
            >
              <TargetRuntime {...target} />
            </PhoneDisclosure>
          )
        }
        phoneExtras={<PhoneExtras target={target} reads={reads} showCharts={showCharts} />}
      />
    </>
  );
}
function PhoneExtras({
  target,
  reads,
  showCharts,
}: {
  target: Parameters<typeof TargetRuntime>[0];
  reads: ResultReads;
  showCharts: boolean;
}) {
  return (
    <>
      {showCharts && (
        <PhoneDisclosure
          id="result-chart-details"
          hashId="result-charts"
          title="More charts"
          description="Requests, virtual users and individual metrics"
        >
          <RecordedMetrics view={target.charts} p95Limit={recordedLimit(target.plan)} />
          <AdvancedMetrics run={target.run} />
        </PhoneDisclosure>
      )}
      <PhoneDisclosure id="result-script" title="Saved script" description="Revision, engine and configuration">
        <ScriptVersion
          run={target.run}
          suite={reads.suite}
          revision={reads.revision}
          failed={reads.revisionQuery.isError}
        />
      </PhoneDisclosure>
    </>
  );
}
