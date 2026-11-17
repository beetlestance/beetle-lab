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

/** What the run held, from stored summary values only; unknown parts are left out. */
function traffic(summary: RunHistorySummary | null): string[] {
  if (!summary) return [];
  const sentences: string[] = [];
  const rps = formatNumber(summary.requestsPerSecond, 'integer');
  const length = spokenLength(summary.testDurationMs);
  if (rps && length) sentences.push(`Held ${rps} requests a second for ${length}.`);
  else if (length) sentences.push(`Ran for ${length}.`);
  const p95 = summary.httpP95 ? `p95 was about ${formatNumber(summary.httpP95.estimate, 'integer')} ms` : null;
  const failed = formatPercent(summary.httpFailureRatio);
  const failedText = failed ? `${failed} of requests failed` : null;
  if (p95 && failedText) sentences.push(`${p95} and ${failedText}.`);
  else if (p95 ?? failedText) sentences.push(`${(p95 ?? failedText)!.replace(/^./, (c) => c.toUpperCase())}.`);
  return sentences;
}
function thresholdLine(result: EngineResult | null): string | null {
  if (!result || result.thresholds.length === 0) return null;
  const failed = result.thresholds.filter((threshold) => !threshold.passed);
  if (failed.length === 0) return 'Every threshold passed.';
  const names = failed.map((threshold) => threshold.id);
  return names.length === 1
    ? `Threshold ${names[0]} failed.`
    : `${names.length} thresholds failed: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}.`;
}

export function headline(
  run: Run,
  suiteName: string | undefined,
  summary: RunHistorySummary | null,
  result: EngineResult | null,
): { title: string; sentence: string } {
  const name = suiteName ?? 'This run';
  const length = formatDuration(summary?.testDurationMs);
  const covered = spokenLength(summary?.testDurationMs ?? null);
  const held = traffic(summary);
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ');
  switch (variantOf(run)) {
    case 'passed':
      return { title: `${name} passed`, sentence: join(...held, thresholdLine(result)) };
    case 'failed':
      return { title: `${name} failed`, sentence: join(...held, thresholdLine(result)) };
    case 'not-judged':
      return { title: `${name} was not judged`, sentence: join(...held, 'The engine did not reach a verdict.') };
    case 'cancelled':
      return {
        title: length ? `${name} was cancelled after ${length}` : `${name} was cancelled`,
        sentence: join(...held, 'Thresholds were not judged because the run stopped early.'),
      };
    case 'out-of-memory':
      return {
        title: `${name} ran out of memory`,
        sentence: join(
          `k6 went over its ${formatBytes(run.budget.memoryBytes)} memory limit and was stopped.`,
          covered ? `Figures cover the first ${covered};` : 'Figures cover the run up to the stop;',
          'thresholds were not judged on a partial run.',
        ),
      };
    case 'output-full':
      return {
        title: `${name} filled its output`,
        sentence: join(
          `The run reached its ${formatBytes(run.budget.outputBytes)} output limit and was stopped at once.`,
          covered ? `Figures cover the first ${covered}.` : null,
        ),
      };
    case 'incomplete':
      return {
        title: `${name} results are incomplete`,
        sentence: join(
          ...held,
          'The results archive could not be verified, so charts and endpoint detail may be unavailable.',
        ),
      };
    case 'errored':
      return {
        title: `${name} errored`,
        sentence: join(`The run stopped: ${reasonLabel(run.reason) ?? 'no reason was recorded'}.`, ...held),
      };
    case 'pending':
      return { title: `${name} is being finalized`, sentence: 'The outcome is pending.' };
  }
}
