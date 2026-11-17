import { useState } from 'react';
import type { EngineResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import { Banner } from '../../../components/Banner.js';
import { Button } from '../../../components/Button.js';
import { formatTime } from '../../run-results/format.js';
import { RunMetrics } from '../metrics/index.js';
import { RunReads } from '../RunReads.js';
import type { RunSnapshotProps } from '../RunSnapshot.js';
import { RunTargetObservations } from '../target-observations/index.js';
import { DeleteRun } from './DeleteRun.js';
import { headline, variantOf } from './headline.js';
import type { Variant } from './headline.js';
import { ReportTabs } from './ReportTabs.js';
import { ResultHeader } from './ResultHeader.js';
import { RunNote } from './RunNote.js';
import { ScriptVersion, SummaryTiles, Thresholds } from './Sections.js';
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
  ['charts', 'Charts'],
  ['target', 'Target runtime'],
  ['report', 'Report'],
] as const;

function ResultBody({ run, refresh }: { run: Run; refresh: RefreshControl | undefined }) {
  const reads = useResultReads(run);
  const [deleting, setDeleting] = useState(false);
  const readOnly = reads.session?.readOnly ?? false;
  const restored = reads.session?.restoredBackup ?? null;
  const view = reads.result.view;
  const engine = view.status === 'ready' ? view.result : null;
  const { title, sentence } = headline(run, reads.suite?.name, reads.summary, engine);
  return (
    <div className="result">
      {restored && <RestoredBanner createdAt={restored.createdAt} />}
      <ResultHeader
        run={run}
        title={title}
        sentence={sentence}
        readOnly={readOnly}
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
        <h2 id="result-summary-title" className="result-section-title">
          Summary
        </h2>
        <SummaryTiles summary={reads.summary} status={reads.summaryStatus} />
        <RunNote run={run} readOnly={readOnly} />
      </section>
      <div className="result-split">
        <ThresholdSection reads={reads} engine={engine} variant={variantOf(run)} />
        <ScriptVersion run={run} suite={reads.suite} revision={reads.revision} failed={reads.revisionQuery.isError} />
      </div>
      <section id="result-charts" className="result-section" aria-label="Charts">
        <RunMetrics run={run} terminal />
      </section>
      <TargetRuntime run={run} engine={engine} />
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
      <Thresholds result={engine} status={status} variant={variant} />
      {status === 'unavailable' && (
        <Button size="sm" variant="text" onClick={() => void reads.result.query.refetch()}>
          Check for the result again
        </Button>
      )}
    </section>
  );
}

/** Exactly one published target-runtime report is shown; none or several are said plainly. */
function TargetRuntime({ run, engine }: { run: Run; engine: EngineResult | null }) {
  const targets = engine ? engine.artifacts.filter((artifact) => artifact.kind === 'target-runtime') : [];
  return (
    <section id="result-target" className="result-section" aria-labelledby="result-target-title">
      <h2 id="result-target-title" className="result-section-title">
        Target runtime
      </h2>
      {targets.length === 0 && <p className="result-muted">No target runtime was sampled during this run.</p>}
      {targets.length > 1 && (
        <p role="alert">Multiple target observation reports were published; this view requires one report.</p>
      )}
      {targets.length === 1 && (
        <RunTargetObservations
          params={{
            organizationId: run.scope.organizationId,
            workspaceId: run.scope.workspaceId,
            runId: run.id,
            attemptId: run.activeAttemptId,
            artifactId: targets[0]!.artifactId,
          }}
          artifact={targets[0]!}
        />
      )}
    </section>
  );
}
