import type { Run } from '@beetle/contracts/api';
import type { StatusTone } from '../../../components/Badge.js';
import type { RuleReading } from './model.js';
import type { PlanStage, RunPlan } from './plan.js';
import { clock, ms } from './format.js';

export type Phase = 'waiting' | 'starting' | 'running' | 'cancelling' | 'finalizing' | 'ended';

export function phaseOf(run: Run, cancelAccepted: boolean, hasFrame: boolean): Phase {
  if (['finished', 'cancelled', 'errored'].includes(run.state)) return 'ended';
  if (run.state === 'finalizing') return 'finalizing';
  if (run.cancellationRequested || cancelAccepted) return 'cancelling';
  if (run.state === 'queued') return 'waiting';
  if (run.state === 'dispatching' || !hasFrame) return 'starting';
  return 'running';
}

export const isEarlyPhase = (phase: Phase) => phase === 'waiting' || phase === 'starting';
export const isStoppingPhase = (phase: Phase) => phase === 'cancelling' || phase === 'finalizing';

const endedLabel = { finished: 'Finished', cancelled: 'Cancelled', errored: 'Errored' } as const;

export function statusOf(phase: Phase, run: Run): { label: string; tone: StatusTone } {
  switch (phase) {
    case 'waiting':
      return { label: 'Queued', tone: 'info' };
    case 'starting':
      return { label: 'Starting', tone: 'running' };
    case 'running':
      return { label: 'Running', tone: 'running' };
    case 'cancelling':
      return { label: 'Cancelling', tone: 'running' };
    case 'finalizing':
      return { label: 'Finalizing', tone: 'running' };
    case 'ended': {
      const state = run.state as keyof typeof endedLabel;
      return { label: endedLabel[state] ?? run.state, tone: state === 'errored' ? 'fail' : 'neutral' };
    }
  }
}

/** "Steady at 1,200 a second" reads as "Holding 1,200 a second" in the headline. */
function stageHeadline(stage: PlanStage): string {
  if (stage.drain) return 'Draining';
  if (stage.label.startsWith('Steady at ')) return `Holding ${stage.label.slice('Steady at '.length)}`;
  if (stage.label.startsWith('Ramp down to ')) return `Ramping down to ${stage.label.slice('Ramp down to '.length)}`;
  if (stage.label.startsWith('Ramp to ')) return `Ramping to ${stage.label.slice('Ramp to '.length)}`;
  return stage.label;
}

export function headlineOf(phase: Phase, suite: string, stage: PlanStage | null, run: Run): string {
  switch (phase) {
    case 'waiting':
      return `${suite} is waiting for capacity`;
    case 'starting':
      return `${suite} is starting`;
    case 'running':
      return stage ? stageHeadline(stage) : `${suite} is running`;
    case 'cancelling':
      return `Cancelling ${suite}`;
    case 'finalizing':
      return `${suite} is finalizing`;
    case 'ended':
      return `${suite} ${run.state === 'errored' ? 'stopped with an error' : run.state}`;
  }
}

/** One sentence about thresholds in the latest window; it never states the verdict. */
export function thresholdSentence(readings: readonly RuleReading[]): string {
  if (!readings.length) return 'No thresholds are set for this revision.';
  const over = readings.filter((r) => r.state === 'over');
  const holding = readings.filter((r) => r.state === 'holding');
  const p95 = readings.find((r) => r.rule.metric === 'http_req_duration' && r.rule.stat === 'p95' && r.value !== null);
  const p95Text = p95
    ? ` p95 is ${p95.bound === 'at-most' ? 'at most ' : ''}${ms(p95.value!)} against a ${ms(p95.rule.value)} limit.`
    : '';
  if (over.length)
    return `${over.length} of ${readings.length} ${readings.length === 1 ? 'threshold is' : 'thresholds are'} over the limit in the latest window.${p95Text}`;
  if (holding.length === readings.length) return `All thresholds are holding.${p95Text}`;
  if (holding.length)
    return `${holding.length} of ${readings.length} thresholds are holding; the rest are checked when the run is sealed.${p95Text}`;
  return 'Thresholds are checked when the run is sealed.';
}

/** "Stopped sending at 05:16 of 10:00. " — empty when the stop point is unknown. */
function stoppedText(prefix: string, stoppedAtMs: number | null, plan: RunPlan): string {
  if (stoppedAtMs === null) return '';
  const total = plan.totalMs === null ? '' : ` of ${clock(plan.totalMs)}`;
  return `${prefix} ${clock(stoppedAtMs)}${total}. `;
}

const phaseSentence: Record<'waiting' | 'starting', string> = {
  waiting: 'The run starts as soon as a slot frees up.',
  starting: 'Live numbers appear as soon as k6 sends its first sample, usually within a few seconds.',
};

/** The sentence under the headline for each phase; never a verdict before the result is sealed. */
export function sentenceOf(
  phase: Phase,
  readings: readonly RuleReading[],
  stoppedAtMs: number | null,
  plan: RunPlan,
  run: Run,
): string {
  switch (phase) {
    case 'waiting':
    case 'starting':
      return phaseSentence[phase];
    case 'running':
      return thresholdSentence(readings);
    case 'cancelling':
      return `${stoppedText('Last live window at', stoppedAtMs, plan)}Cancellation requested; waiting for the agent to confirm that execution has stopped.`;
    case 'finalizing': {
      const after = run.cancellationRequested ? ' after the cancellation request' : '';
      return `Sealing results${after}. The outcome appears when sealing finishes.`;
    }
    case 'ended':
      return run.outcome === 'pending' ? 'The outcome is still pending.' : `Outcome: ${run.outcome}.`;
  }
}
