import { useState } from 'react';
import { TargetHeader, usePhaseMode } from './TargetHeader.js';
import type { EngineResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
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
import { ReportTabs } from './ReportTabs.js';
import { ResultHeader } from './ResultHeader.js';
import { RunNote } from './RunNote.js';
import { ScriptVersion, SummaryTiles, Thresholds } from './Sections.js';
import { MetricSummary, ResultEndpoints, OverviewStatus, readyOverview } from './Overview.js';
import type { RunPlan } from '../live/plan.js';
import { readPlan } from '../live/plan.js';
import { useResultReads } from './useResultReads.js';
import type { ResultReads } from './useResultReads.js';
import './result.css';

/**
 * Run result view (Penpot "Run result" boards and their variants) for a terminal
 * run. RunDetail chooses it once; it owns its reads under the scoped run key.
 */
/** RunDetail's run re-read, shown as Refresh run beside the result title. */
export type RefreshControl = { readonly run: () => void; readonly busy: boolean };

export function RunResultView({ run, scope, runId, refresh }: RunSnapshotProps & { refresh?: RefreshControl }) {
  return (
    <RunReads key={`${scope.organizationId}/${scope.workspaceId}/${runId}/${run.activeAttemptId}`}>
      <ResultBody run={{ ...run, scope, id: runId }} refresh={refresh} />
    </RunReads>
  );
}

const sections = [
  ['summary', 'Summary'],
  ['thresholds', 'Thresholds'],
  ['endpoints', 'Endpoints'],
  ['charts', 'Charts'],
  ['target', 'Target runtime'],
  ['report', 'Report'],
] as const;

function ResultBody({ run, refresh }: { run: Run; refresh: RefreshControl | undefined }) {
  const reads = useResultReads(run);
  const { phaseView, className, togglePhases } = usePhaseMode();
  const [deleting, setDeleting] = useState(false);
  const { readOnly, restoredBackup: restored } = useSessionAccess();
  const view = reads.result.view;
  const ready = readyOverview(reads.overview);
  const charts = useRecordedCharts(reads.chartHistory);
  const plan = readPlan(reads.revision?.config);
  const engine = view.status === 'ready' ? view.result : null;
  const { title, sentence } = headline(run, reads.suite?.name, reads.summary, engine, readOnly);
  return (
    <div className={className}>
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
        ordinal={reads.revision?.ordinal}
        suiteName={reads.suite?.name}
        onDelete={() => setDeleting(true)}
        refresh={refresh}
      />
      <nav className="result-nav" aria-label="Result sections">
        {sections.map(([id, label]) => (
          <a key={id} href={`#result-${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <section id="result-summary" className="result-section" aria-labelledby="result-summary-title">
        <h2 id="result-summary-title" className="sr-only">
          Summary
        </h2>
        <OverviewStatus query={reads.overview} />
        {ready ? (
          <MetricSummary overview={ready} history={charts.data} />
        ) : (
          <SummaryTiles summary={reads.summary} status={reads.summaryStatus} />
        )}
        <RunNote run={run} readOnly={readOnly} />
      </section>
      <RecordedWhole view={charts} p95Limit={recordedLimit(plan)} plan={plan} />
      <div className="result-split">
        <ThresholdSection reads={reads} engine={engine} variant={variantOf(run)} />
        <ScriptVersion run={run} suite={reads.suite} revision={reads.revision} failed={reads.revisionQuery.isError} />
      </div>
      <ResultEndpoints overview={ready} requests={plan.requests} />
      <RecordedMetrics view={charts} p95Limit={recordedLimit(plan)} />
      <AdvancedMetrics run={run} />
      <TargetRuntime
        run={run}
        engine={engine}
        status={view.status}
        charts={charts}
        plan={plan}
        phaseView={phaseView}
        togglePhases={togglePhases}
      />
      <ReportTabs run={run} view={view} />
      {deleting && !readOnly && <DeleteRun run={run} onClose={() => setDeleting(false)} />}
    </div>
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
      {status === 'unavailable' && (
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
      <TargetHeader plan={plan} phaseView={phaseView} togglePhases={togglePhases} />
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
