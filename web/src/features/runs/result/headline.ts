import type { PlanRule } from '../live/plan.js';
import { thresholdSentence } from './threshold-sentence.js';
import { terminal } from '../terminal.js';
import type { EngineResult } from '@beetle/contracts';
import type { Run, RunHistorySummary, RunMetricOverview } from '@beetle/contracts/api';
import { formatBytes, formatDuration, formatNumber, formatPercent, reasonLabel } from '../../run-results/format.js';

export type Variant =
  | 'passed'
  | 'failed'
  | 'not-judged'
  | 'cancelled'
  | 'out-of-memory'
  | 'output-full'
  | 'incomplete'
  | 'errored'
  | 'pending';

export function variantOf(run: Pick<Run, 'state' | 'outcome' | 'reason'>): Variant {
  if (run.state === 'cancelled') return 'cancelled';
  if (run.reason === 'memory_limit') return 'out-of-memory';
  if (run.reason === 'output_limit') return 'output-full';
  if (run.reason === 'artifact_incomplete') return 'incomplete';
  if (run.state === 'errored') return 'errored';
  if (run.outcome === 'passed') return 'passed';
  if (run.outcome === 'failed') return 'failed';
  if (run.outcome === 'inconclusive') return 'not-judged';
  return 'pending';
}

/** Spoken length: "16 minutes", "4 minutes 12 seconds". */
export function spokenLength(ms: number | null, compact = false): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (compact) return minutes === 0 ? `${seconds}s` : `${minutes} min${seconds === 0 ? '' : ` ${seconds}s`}`;
  const part = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  if (minutes === 0) return part(seconds, 'second');
  return seconds === 0 ? part(minutes, 'minute') : `${part(minutes, 'minute')} ${part(seconds, 'second')}`;
}

/** Recorded whole-run average, never a claim that a rate held steadily. */
type Traffic = Pick<RunHistorySummary, 'requestsPerSecond' | 'testDurationMs' | 'httpP95' | 'httpFailureRatio'>;
function averageSentence(summary: Traffic): string | null {
  const rps = formatNumber(summary.requestsPerSecond, 'integer');
  const length = spokenLength(summary.testDurationMs);
  if (!length) return null;
  return rps ? `Averaged ${rps} requests a second over ${length}.` : `Ran for ${length}.`;
}

/** "p95 was about 120 ms and 1% of requests failed."; either half alone is capitalised. */
function qualitySentence(summary: Traffic): string | null {
  const p95 = summary.httpP95 ? `p95 was about ${formatNumber(summary.httpP95.estimate, 'integer')} ms` : null;
  const failed = formatPercent(summary.httpFailureRatio);
  const failedText = failed ? `${failed} of requests failed` : null;
  if (p95 && failedText) return `${p95} and ${failedText}.`;
  const one = p95 ?? failedText;
  return one ? `${one.replace(/^./, (c) => c.toUpperCase())}.` : null;
}

/** What the run held, from stored summary values only; unknown parts are left out. */
function traffic(summary: Traffic | null): string[] {
  if (!summary) return [];
  return [averageSentence(summary), qualitySentence(summary)].filter((sentence): sentence is string => !!sentence);
}

type Context = {
  run: Run;
  name: string;
  length: string | null;
  covered: string | null;
  held: string[];
  result: EngineResult | null;
  rules: readonly PlanRule[];
};
type Headline = { title: string; sentence: string };
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ');

const headlines: Record<Variant, (context: Context) => Headline> = {
  passed: ({ name, held, result }) => ({ title: `${name} passed`, sentence: join(...held, thresholdSentence(result)) }),
  failed: ({ name, held, result, rules }) => ({
    title: `${name} failed`,
    sentence: join(...held, thresholdSentence(result, rules)),
  }),
  'not-judged': ({ name, held }) => ({
    title: `${name} was not judged`,
    sentence: join(...held, 'The engine did not reach a verdict.'),
  }),
  cancelled: ({ name, length, held }) => ({
    title: length ? `${name} was cancelled after ${length}` : `${name} was cancelled`,
    sentence: join(...held, 'Thresholds were not judged because the run stopped early.'),
  }),
  'out-of-memory': ({ run, name, covered }) => ({
    title: `${name} ran out of memory`,
    sentence: join(
      `k6 went over its ${formatBytes(run.budget.memoryBytes)} memory limit and was stopped.`,
      covered ? `Figures cover the first ${covered};` : 'Figures cover the run up to the stop;',
      'thresholds were not judged on a partial run.',
    ),
  }),
  'output-full': ({ run, name, covered }) => ({
    title: `${name} filled its output`,
    sentence: join(
      `The run reached its ${formatBytes(run.budget.outputBytes)} output limit and was stopped at once.`,
      covered ? `Figures cover the first ${covered}.` : null,
    ),
  }),
  incomplete: ({ name, held, result }) => ({
    title: `${name} results are incomplete`,
    sentence: incompleteSentence(held, result),
  }),
  errored: ({ run, name, held }) => ({
    title: `${name} errored`,
    sentence: join(`The run stopped: ${reasonLabel(run.reason) ?? 'no reason was recorded'}.`, ...held),
  }),
  pending: ({ name }) => ({ title: `${name} is being finalized`, sentence: 'The outcome is pending.' }),
};

function incompleteSentence(held: readonly string[], result: EngineResult | null): string {
  const native = result?.nativeOverview;
  if (!native)
    return join(
      ...held,
      'The results archive could not be verified, so charts and endpoint detail may be unavailable.',
    );
  const duration = spokenLength(native.durationMs);
  return join(
    duration ? `k6 recorded measurements for ${duration}.` : null,
    'The archive could not be verified. Charts and endpoint detail are unavailable.',
  );
}

export function headline(
  run: Run,
  suiteName: string | undefined,
  summary: RunHistorySummary | null,
  result: EngineResult | null,
  context: {
    readOnly?: boolean;
    rules?: readonly PlanRule[];
    measurements?: RunMetricOverview | null;
    phone?: boolean;
  } = {},
): Headline {
  if (context.readOnly && !terminal(run))
    return {
      title: `${suiteName ?? 'This run'} was ${run.state} at backup`,
      sentence: 'This unfinished run is recorded history. Restoring a backup does not resume it.',
    };
  const measurements = headlineTraffic(summary, context.measurements);
  const phone = phonePassedHeadline(run, measurements, result, context.phone === true);
  if (phone) return phone;
  const duration = measurements?.testDurationMs ?? null;
  return headlines[variantOf(run)]({
    run,
    name: suiteName ?? 'This run',
    length: formatDuration(duration),
    covered: spokenLength(duration),
    held: traffic(measurements),
    result,
    rules: context.rules ?? [],
  });
}

/** One ready overview supplies every traffic field; nulls never borrow index values. */
function headlineTraffic(
  summary: RunHistorySummary | null,
  overview: RunMetricOverview | null | undefined,
): Traffic | null {
  if (overview?.availability !== 'ready') return summary;
  return {
    testDurationMs: overview.testDurationMs,
    requestsPerSecond: overview.requestsPerSecond,
    httpP95: overview.latency?.percentiles.p95 ?? null,
    httpFailureRatio: overview.failure?.ratio ?? null,
  };
}

/** Prominent traffic remains a measured average, never a steady-rate assertion. */
function phonePassedHeadline(
  run: Run,
  measurements: Traffic | null,
  result: EngineResult | null,
  phone: boolean,
): Headline | null {
  if (!phone || variantOf(run) !== 'passed' || !measurements) return null;
  const rate = formatNumber(measurements.requestsPerSecond, 'integer');
  const duration = spokenLength(measurements.testDurationMs, true);
  if (rate === null || duration === null) return null;
  return {
    title: `Averaged ${rate} req/s over ${duration}`,
    sentence: join(thresholdSentence(result), phoneLatency(measurements.httpP95)),
  };
}

function phoneLatency(p95: Traffic['httpP95']): string | null {
  return p95 ? `p95 latency was about ${formatNumber(p95.estimate, 'integer')} ms.` : null;
}
