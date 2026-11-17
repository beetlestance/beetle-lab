import type { OverviewCounts, RunHistorySummary } from '@beetle/contracts/api';
import type { StatusTone } from '../../components/Badge.js';

type RunState = 'queued' | 'dispatching' | 'active' | 'finalizing' | 'finished' | 'cancelled' | 'errored';
type RunOutcome = 'pending' | 'passed' | 'failed' | 'inconclusive';

/** One label and tone for a run header, from application state and outcome only. */
export function runStatus(state: RunState, outcome: RunOutcome): { label: string; tone: StatusTone } {
  switch (state) {
    case 'queued':
      return { label: 'Queued', tone: 'info' };
    case 'dispatching':
      return { label: 'Starting', tone: 'info' };
    case 'active':
      return { label: 'Running', tone: 'running' };
    case 'finalizing':
      return { label: 'Finalizing', tone: 'running' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'skipped' };
    case 'errored':
      return { label: 'Errored', tone: 'fail' };
    case 'finished':
      if (outcome === 'passed') return { label: 'Passed', tone: 'pass' };
      if (outcome === 'failed') return { label: 'Failed', tone: 'fail' };
      return { label: 'Inconclusive', tone: 'neutral' };
  }
}

/** Runs not yet terminal: queued, starting, running or finalizing. */
export function inProgress(counts: OverviewCounts): number {
  return counts.queued + counts.dispatching + counts.active + counts.finalizing;
}

export function plural(count: number, one: string, many = one + 's'): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Display ID: the first four hex digits of a UUID ("a7f2"). Accessible names keep the full ID. */
export function shortId(id: string): string {
  return id
    .replace(/^urn:uuid:/i, '')
    .slice(0, 4)
    .toLowerCase();
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export function clockTime(iso: string): string {
  return clock.format(new Date(iso));
}

/** "Today, 23:35", "Yesterday, 18:40" or "12 Nov, 09:10", in the viewer's time zone. */
export function when(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  const prefix = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : day.format(date);
  return `${prefix}, ${clock.format(date)}`;
}

/** "05:16" or "1:05:16" for an elapsed number of seconds. */
export function elapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Recorded p95 as "188 ms", or null when the summary has none. */
export function p95(summary: RunHistorySummary | undefined): string | null {
  const value = summary?.httpP95;
  return value ? `${Math.round(value.estimate).toLocaleString()} ms` : null;
}

const gib = 1024 ** 3;
export function gibibytes(bytes: number): string {
  const value = bytes / gib;
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1).replace(/\.0$/, '');
}
