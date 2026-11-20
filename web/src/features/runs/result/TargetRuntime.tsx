import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import type { Artifact, EngineResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { RunPlan } from '../live/plan.js';
import { useTargetReport } from '../target-observations/useReport.js';
import type { useRecordedCharts } from './RecordedCharts.js';
import { TargetHeader } from './TargetHeader.js';
import { TargetReportContent } from './TargetReport.js';
import type { ResultReads } from './useResultReads.js';

type Report = ReturnType<typeof useTargetReport>;
const TargetReadContext = createContext<{ report: Report; start(): void } | null>(null);

function TargetReadOwner({ run, artifact, children }: { run: Run; artifact: Artifact; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const report = useTargetReport(
    {
      params: {
        organizationId: run.scope.organizationId,
        workspaceId: run.scope.workspaceId,
        runId: run.id,
        attemptId: run.activeAttemptId,
        artifactId: artifact.artifactId,
      },
      artifact,
    },
    undefined,
    revealed,
  );
  const start = useCallback(() => setRevealed(true), []);
  return <TargetReadContext.Provider value={{ report, start }}>{children}</TargetReadContext.Provider>;
}

/** Keep the read owner stable when the same report moves between responsive views. */
export function WithTargetReport({
  run,
  engine,
  children,
}: {
  run: Run;
  engine: EngineResult | null;
  children: ReactNode;
}) {
  const artifacts = engine?.artifacts.filter((artifact) => artifact.kind === 'target-runtime') ?? [];
  return artifacts.length === 1 ? (
    <TargetReadOwner run={run} artifact={artifacts[0]!}>
      {children}
    </TargetReadOwner>
  ) : (
    children
  );
}

function ResponsiveTargetReport(props: Omit<ComponentProps<typeof TargetReportContent>, 'report'>) {
  const target = useContext(TargetReadContext);
  const start = target?.start;
  useEffect(() => {
    start?.();
  }, [start]);
  if (!target) return null;
  return <TargetReportContent {...props} report={target.report} />;
}

/** Exactly one published target-runtime report is shown; none or several are said plainly. */
export function TargetRuntime({
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
        <ResponsiveTargetReport
          artifact={targets[0]!}
          phaseView={phaseView}
          nativeOrigin={charts.data?.source?.measurementSourceTimeMs ?? null}
          hover={charts.hover}
        />
      )}
    </section>
  );
}
