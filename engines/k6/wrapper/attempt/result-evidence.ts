import { createHash } from 'node:crypto';
import { sealEngineResult } from '@beetle/contracts';
import { nativeOverview } from './native-overview.js';
import { ArchiveDigestMismatch } from './archive/index.js';
import type { MetricArchive, ArchiveEvidence } from './archive/index.js';
import { renderPerformanceReports, ReportError } from '../../report/index.js';
import type { EngineResult } from '@beetle/contracts';
import type { CompiledInput } from '../input/index.js';
import { mapK6Result } from '../result/index.js';
import type { K6ResultInput, K6ResultMapping } from '../result/index.js';
import type { TargetSamplingReport } from '../target-sampling/index.js';
import type { OutputReservation } from './reservation.js';
import { AttemptError } from './types.js';
import type { State } from './state.js';
import type { Artifacts } from '../artifact-custody/index.js';
export async function finishMetricEvidence(
  archive: MetricArchive | undefined,
  state: State,
  compiled: CompiledInput,
  mapped: MappedResult,
) {
  const receipt = state.execution!;
  if (receipt.metrics === null) {
    await archive?.close();
    return { history: null, evidence: state, mapped };
  }
  try {
    return { history: await archive!.finish(), evidence: state, mapped };
  } catch (error) {
    if (!(error instanceof ArchiveDigestMismatch) || !canRetainNativeSummary(receipt, mapped)) throw error;
    const summary = receipt.summary;
    if (!summary?.ok) throw new AttemptError('artifact');
    const evidence: State = { ...state, execution: { ...receipt, ok: false, code: 'metrics', metrics: null } };
    const partial = mapK6Result(resultEvidence(evidence, compiled, [], nativeOverview(summary.evidence)));
    if (!partial.ok) throw new AttemptError('mapping');
    return { history: null, evidence, mapped: partial };
  }
}

function canRetainNativeSummary(receipt: NonNullable<State['execution']>, mapped: MappedResult): boolean {
  return (
    receipt.ok &&
    receipt.summary?.ok === true &&
    receipt.summary.evidence.nativeCollection === 'complete' &&
    mapped.body.completeness === 'complete' &&
    mapped.body.execution.status === 'completed'
  );
}

export function resultEvidence(
  state: State,
  compiled: CompiledInput,
  artifacts: EngineResult['artifacts'],
  native?: EngineResult['nativeOverview'],
): K6ResultInput {
  const receipt = state.execution!;
  if (!receipt.process || !receipt.terminalObservedAt) throw new AttemptError('execution');
  // Native cause already carries cancellation/output-limit identity. Do not mask it as engine_crash.
  const failure = receipt.ok ? null : receipt.code === 'native' && receipt.process.cause !== null ? null : receipt.code;
  return {
    suite: compiled.suite,
    scope: state.scope!,
    process: receipt.process,
    terminalObservedAt: receipt.terminalObservedAt,
    orchestrationFailure: failure,
    orchestrationQuiescent: true,
    summary: receipt.summary?.ok ? receipt.summary.evidence : null,
    metrics: receipt.metrics,
    artifacts,
    ...(native ? { nativeOverview: native } : {}),
  };
}
export function targetReportWithSpan(
  report: TargetSamplingReport | undefined,
  receipt: NonNullable<State['execution']>,
): TargetSamplingReport | undefined {
  if (!report || !receipt.ok || !receipt.summary?.ok || receipt.summary.evidence.nativeCollection !== 'complete')
    return report;
  const requestSpan = receipt.metrics?.requestSpan;
  return requestSpan ? { ...report, requestSpan } : report;
}
export function performanceReports(
  mapped: MappedResult,
  state: State,
  reservation: OutputReservation,
  targetReport: TargetSamplingReport | undefined,
) {
  try {
    return renderPerformanceReports({
      result: mapped.body,
      metrics: state.execution!.metrics,
      maximumBytes: reservation.reports / 2,
      ...(targetReport ? { target: targetReport } : {}),
    });
  } catch (error) {
    throw new AttemptError(error instanceof ReportError && error.code === 'output_limit' ? 'output_limit' : 'artifact');
  }
}
export function archiveAccounting(
  archive: MetricArchive | undefined,
  historyAtCollect: number,
  history: ArchiveEvidence | null,
) {
  return {
    produced: (archive?.bytes ?? 0) - historyAtCollect,
    published: history?.bytes ?? 0,
    artifacts: history?.artifacts ?? [],
  };
}
/** Native request landmarks live only in the verified target report. */
function numericSnapshot(snapshot: NonNullable<State['execution']>['metrics']) {
  if (!snapshot) return null;
  const { totals, totalsComplete, measurement, windowCoverage, quantiles } = snapshot;
  return { totals, totalsComplete, measurement, windowCoverage, quantiles };
}

export function writeNumericEvidence(
  artifacts: Pick<Artifacts, 'numeric'>,
  state: State,
  diagnostics: MappingDiagnostics,
  history: ArchiveEvidence | null,
  allowance: number,
) {
  const summary = state.execution!.summary;
  const timing =
    summary?.ok && summary.evidence.nativeCollection === 'complete'
      ? summary.evidence.timing
      : { testRunDurationMs: null };
  const preview = history?.httpP95Preview;
  const base = {
    version: 4,
    timing,
    scope: state.scope,
    metrics: numericSnapshot(state.execution!.metrics),
    diagnostics,
    buildUsage: buildUsage(state),
    windowsRetained: history !== null,
    history: history
      ? {
          windows: history.windows,
          bytes: history.bytes,
          dataArtifactId: history.dataArtifactId,
          indexArtifactId: history.indexArtifactId,
        }
      : null,
    quantiles: state.execution!.metrics?.quantiles ?? 'unknown',
  };
  return artifacts.numeric(base, allowance, preview ? { ...base, version: 5, httpP95Preview: preview } : undefined);
}
export function buildUsage(state: State): { bytes: number; peakBytes: number } | null {
  const build = state.execution?.build;
  return build ? { bytes: build.bytes, peakBytes: build.peakBytes } : null;
}
export type MappedResult = Extract<K6ResultMapping, { ok: true }>;
type MappingDiagnostics = Extract<K6ResultMapping, { ok: true }>['diagnostics'];

export function artifactBytes(value: EngineResult['artifacts'][number] | undefined): number {
  return value?.bytes ?? 0;
}
export function presentArtifacts(
  ...values: (EngineResult['artifacts'][number] | undefined)[]
): EngineResult['artifacts'] {
  return values.filter((value): value is EngineResult['artifacts'][number] => value !== undefined);
}

export function sealResult(body: MappedResult['body'], timestamp: string) {
  return sealEngineResult(body, timestamp, (text) => createHash('sha256').update(text).digest('hex'));
}
