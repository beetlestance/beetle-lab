import type { Run } from '@beetle/contracts/api';
import type { StatusTone } from '../../components/Badge.js';

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Display ID used across the design ("run a7f2"): the UUID's first four characters. */
export function shortId(id: string): string {
  return id.slice(0, 4).toLowerCase();
}

/** "05:16" or "1:05:16". Null stays unknown, never zero. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export function formatTime(iso: string): string {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? timeFormat.format(value) : iso;
}

export function formatNumber(
  value: number | null | undefined,
  digits: 'integer' | 'decimal' = 'decimal',
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return (digits === 'integer' ? integer : decimal).format(value);
}

export function formatPercent(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  return `${decimal.format(ratio * 100)}%`;
}

const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? integer.format(value) : decimal.format(Math.round(value * 10) / 10)} ${units[unit]}`;
}

/** Start time when 031 recorded one, otherwise the request time (labelled by the caller). */
export function startedAt(run: Pick<Run, 'startedAt' | 'requestedAt'>): { iso: string; recorded: boolean } {
  return run.startedAt ? { iso: run.startedAt, recorded: true } : { iso: run.requestedAt, recorded: false };
}

/** Wall-clock length from recorded start and finish; null when either is missing. */
export function wallClockMs(run: Pick<Run, 'startedAt' | 'finishedAt'>): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const value = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const reasons: Partial<Record<NonNullable<Run['reason']>, string>> = {
  memory_limit: 'Out of memory',
  output_limit: 'Output full',
  artifact_incomplete: 'Incomplete results',
  timeout: 'Timed out',
  engine_crash: 'Engine crashed',
  execution_lost: 'Execution lost',
  setup_failed: 'Setup failed',
  invalid_config: 'Invalid configuration',
  budget_unavailable: 'Budget unavailable',
};

/** One label and tone for a run's application state and outcome; meaning is in the text. */
export function runStatus(run: Pick<Run, 'state' | 'outcome' | 'reason'>): { label: string; tone: StatusTone } {
  switch (run.state) {
    case 'queued':
    case 'dispatching':
      return { label: 'Queued', tone: 'info' };
    case 'active':
      return { label: 'Running', tone: 'running' };
    case 'finalizing':
      return { label: 'Finalizing', tone: 'running' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'skipped' };
    case 'errored':
      return { label: (run.reason && reasons[run.reason]) ?? 'Errored', tone: 'fail' };
    case 'finished':
      if (run.outcome === 'passed') return { label: 'Passed', tone: 'pass' };
      if (run.outcome === 'failed') return { label: 'Failed', tone: 'fail' };
      if (run.outcome === 'inconclusive') return { label: 'Not judged', tone: 'neutral' };
      return { label: 'Pending', tone: 'neutral' };
  }
}

export function reasonLabel(reason: Run['reason']): string | null {
  return reason ? (reasons[reason] ?? reason.replaceAll('_', ' ')) : null;
}
