// Snapshot arithmetic the contract enforces (counts, hourly buckets, list lengths), derived from
// the rows a snapshot lists so a fixture can never contradict itself.
import type { Json } from '../../harness.js';
import { HOUR, NOW_MS, iso } from './ids.js';

export interface Header {
  readonly requestedAt: string;
  readonly state: string;
  readonly outcome: string;
}
/** A run inside the 24 hours that the recent list does not show. */
export interface Hidden {
  /** Hour bucket, 0 = oldest, 23 = newest. */
  readonly hour: number;
  readonly outcome: 'passed' | 'failed';
}

const start = NOW_MS - 24 * HOUR;
type Category = 'passed' | 'failed' | 'inProgress' | 'other';

function category(row: Header): Category {
  if (row.state === 'finished')
    return row.outcome === 'passed' ? 'passed' : row.outcome === 'failed' ? 'failed' : 'other';
  return row.state === 'cancelled' || row.state === 'errored' ? 'other' : 'inProgress';
}

/** Counts and 24 hourly buckets for the listed runs, hidden in-window runs, and `older` finished runs. */
export function snapshotFacts(rows: readonly Header[], hidden: readonly Hidden[] = [], older = 21) {
  const outcomes = Array.from({ length: 24 }, () => ({ passed: 0, failed: 0, inProgress: 0, other: 0 }));
  const states: Record<string, number> = {
    queued: 0,
    dispatching: 0,
    active: 0,
    finalizing: 0,
    finished: older,
    cancelled: 0,
    errored: 0,
  };
  let submitted = 0;
  let failed = 0;
  const add = (hour: number, cat: Category) => {
    outcomes[hour]![cat]++;
    submitted++;
    if (cat === 'failed') failed++;
  };
  for (const row of rows) {
    states[row.state]!++;
    const hour = Math.floor((Date.parse(row.requestedAt) - start) / HOUR);
    if (hour >= 0 && hour < 24) add(hour, category(row));
  }
  for (const run of hidden) {
    states.finished!++;
    add(run.hour, run.outcome);
  }
  const buckets: Json[] = outcomes.map((o, i) => ({
    from: iso(start + i * HOUR),
    to: iso(start + (i + 1) * HOUR),
    count: o.passed + o.failed + o.inProgress + o.other,
    outcomes: o,
  }));
  const runs = Object.values(states).reduce((sum, n) => sum + n, 0);
  return { buckets, counts: { ...states, runs, submitted24h: submitted, failed24h: failed } };
}
