import type { PlanRule } from '../live/plan.js';
import { thresholdSentence } from './threshold-sentence.js';
import { terminal } from '../terminal.js';
import type { EngineResult } from '@beetle/contracts';
import type { Run, RunHistorySummary } from '@beetle/contracts/api';
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
export function spokenLength(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const part = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  if (minutes === 0) return part(seconds, 'second');
  return seconds === 0 ? part(minutes, 'minute') : `${part(minutes, 'minute')} ${part(seconds, 'second')}`;
}

/** "Held 4 requests a second for 2 seconds." or "Ran for 2 seconds."; nothing without a length. */
function heldSentence(summary: RunHistorySummary): string | null {
  const rps = formatNumber(summary.requestsPerSecond, 'integer');
  const length = spokenLength(summary.testDurationMs);
  if (!length) return null;
  return rps ? `Held ${rps} requests a second for ${length}.` : `Ran for ${length}.`;
}

/** "p95 was about 120 ms and 1% of requests failed."; either half alone is capitalised. */
function qualitySentence(summary: RunHistorySummary): string | null {
  const p95 = summary.httpP95 ? `p95 was about ${formatNumber(summary.httpP95.estimate, 'integer')} ms` : null;
  const failed = formatPercent(summary.httpFailureRatio);
  const failedText = failed ? `${failed} of requests failed` : null;
  if (p95 && failedText) return `${p95} and ${failedText}.`;
  const one = p95 ?? failedText;
  return one ? `${one.replace(/^./, (c) => c.toUpperCase())}.` : null;
}

/** What the run held, from stored summary values only; unknown parts are left out. */
function traffic(summary: RunHistorySummary | null): string[] {
  if (!summary) return [];
  return [heldSentence(summary), qualitySentence(summary)].filter((sentence): sentence is string => !!sentence);
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
  incomplete: ({ name, held }) => ({
    title: `${name} results are incomplete`,
    sentence: join(
      ...held,
      'The results archive could not be verified, so charts and endpoint detail may be unavailable.',
    ),
  }),
  errored: ({ run, name, held }) => ({
    title: `${name} errored`,
    sentence: join(`The run stopped: ${reasonLabel(run.reason) ?? 'no reason was recorded'}.`, ...held),
  }),
  pending: ({ name }) => ({ title: `${name} is being finalized`, sentence: 'The outcome is pending.' }),
};

export function headline(
  run: Run,
  suiteName: string | undefined,
  summary: RunHistorySummary | null,
  result: EngineResult | null,
  context: { readOnly?: boolean; rules?: readonly PlanRule[] } = {},
): Headline {
  if (context.readOnly && !terminal(run))
    return {
      title: `${suiteName ?? 'This run'} was ${run.state} at backup`,
      sentence: 'This unfinished run is recorded history. Restoring a backup does not resume it.',
    };
  return headlines[variantOf(run)]({
    run,
    name: suiteName ?? 'This run',
    length: formatDuration(summary?.testDurationMs),
    covered: spokenLength(summary?.testDurationMs ?? null),
    held: traffic(summary),
    result,
    rules: context.rules ?? [],
  });
}
