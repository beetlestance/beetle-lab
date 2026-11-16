import { encodeJson, validate } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import type { MetricSnapshot } from '../aggregation/index.js';
import type { K6ResultBody } from '../wrapper/result/index.js';
import { captureSeries, describe, statisticColumns, statistics } from './series.js';
import { csvCell, ReportError, ReportWriter } from './writer.js';
export { ReportError } from './writer.js';

export interface PerformanceReports {readonly text: Uint8Array; readonly csv: Uint8Array}
interface Options {readonly result: K6ResultBody; readonly metrics: MetricSnapshot | null; readonly maximumBytes: number}
function capturedResult(input: K6ResultBody): EngineResult {
  const witness = JSON.parse(encodeJson({...input, seal: {sha256: '0'.repeat(64), sealedAt: '2000-01-01T00:00:00.000Z'}}, 1048576)) as unknown;
  const checked = validate('EngineResult', witness);
  if (!checked.ok) throw new ReportError('invalid_input'); return checked.value;
}
function coverage(input: MetricSnapshot | null): string {
  if (input === null) return 'missing';
  if (input.totalsComplete !== true || input.measurement.complete !== true || input.quantiles !== 'histogram-estimate') throw new ReportError('invalid_input');
  const value = input.windowCoverage;
  for (const count of [value.latePoints, value.markerDelayDroppedBuckets]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new ReportError('invalid_input');
  }
  if (typeof value.complete !== 'boolean') throw new ReportError('invalid_input');
  return value.complete ? 'complete' : `partial; latePoints=${value.latePoints}; markerDelayDroppedBuckets=${value.markerDelayDroppedBuckets}`;
}
/** Pure bounded presentation of mapped outcome and admitted numeric evidence; no I/O or outcome inference. */
export function renderPerformanceReports(options: Options): PerformanceReports {
  try {return render(options);} catch (error) {
    if (error instanceof ReportError) throw error;
    throw new ReportError('invalid_input');
  }
}
function render(options: Options): PerformanceReports {
  const text = new ReportWriter(options.maximumBytes); const csv = new ReportWriter(options.maximumBytes);
  const result = capturedResult(options.result); const windowCoverage = coverage(options.metrics);
  const series = captureSeries(options.metrics?.totals ?? []);
  text.line('Beetle Lab performance report');
  text.line(`Attempt: ${result.attemptId}; generation: ${result.generation}`);
  text.line(`Outcome: ${result.outcome}; execution: ${result.execution.status}; mode: ${result.mode}`);
  text.line(`Result completeness: ${result.completeness}; metric window coverage: ${windowCoverage}`);
  const assertions = result.requiredAssertions;
  text.line(`Required assertion definitions: ${assertions.required}; passed=${assertions.passed}; failed=${assertions.failed}; unknown=${assertions.unknown}`);
  for (const threshold of result.thresholds) text.line(`Threshold ${threshold.id} [${threshold.purpose}]: ${threshold.passed ? 'passed' : 'failed'}`);
  if (result.mode === 'discovery') text.line(`Discovery rule ${result.expectedAbort.ruleId}: reached=${result.expectedAbort.reached}`);
  text.line(`Observed metric series: ${series.length}. Missing series/statistics are unknown, not zero.`);
  text.line('Scopes: execute workload and engine resources; readiness/control and target sensors are separate.');
  text.line('Duration percentiles are histogram estimates with lower/upper bounds; totals and window coverage are distinct.');
  csv.line(['recordType', 'attemptId', 'generation', 'outcome', 'resultCompleteness', 'windowCoverage', 'observedSeries', 'metric', 'kind', 'scope', 'phase', 'request', 'assertion', 'unit', ...statisticColumns].map(csvCell).join(','));
  csv.line(['summary', result.attemptId, result.generation, result.outcome, result.completeness, windowCoverage, series.length,
    ...Array<null>(7 + statisticColumns.length).fill(null)].map(csvCell).join(','));
  for (const value of series) {
    text.line(describe(value));
    csv.line(['series', result.attemptId, result.generation, result.outcome, result.completeness, windowCoverage, series.length,
      value.metric, value.kind, value.scope, value.tags.phase ?? null, value.tags.request ?? null, value.tags.assertion ?? null,
      value.unit, ...statistics(value.total)].map(csvCell).join(','));
  }
  return Object.freeze({text: text.finish(), csv: csv.finish()});
}
