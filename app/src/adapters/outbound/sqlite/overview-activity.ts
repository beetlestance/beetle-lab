import type { DatabaseSync } from 'node:sqlite';
import type { OverviewBucket } from '@beetle/contracts/api';
import type { OverviewFilter } from './overview-filter.js';
import { StorageError } from './protocol.js';
const hour = 3600000;
/** Same statement used by the worker read and query-plan tests. Integer milliseconds avoid boundary rounding. */
export function overviewActivitySql(filter: OverviewFilter): string {
  return `SELECT CAST((unixepoch(requested_at)*1000+CAST(substr(requested_at,21,3) AS INTEGER)-?)/? AS INTEGER) AS bucket,
    COUNT(*) AS count,
    SUM(state='finished' AND outcome='passed') AS passed,
    SUM(state='finished' AND outcome='failed') AS failed,
    SUM(state IN ('queued','dispatching','active','finalizing') AND outcome='pending') AS inProgress,
    SUM(state IN ('cancelled','errored','finished') AND outcome='inconclusive') AS other
    FROM runs WHERE ${filter.where} AND requested_at>=? AND requested_at<? GROUP BY bucket`;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new StorageError('unavailable');
  return value;
}
export function readOverviewActivity(db: DatabaseSync, filter: OverviewFilter, now: string): OverviewBucket[] {
  const start = Date.parse(now) - 24 * hour;
  const from = new Date(start).toISOString();
  const rows = db.prepare(overviewActivitySql(filter)).all(start, hour, ...filter.args, from, now);
  const grouped = new Map<number, Pick<OverviewBucket, 'count' | 'outcomes'>>();
  for (const row of rows) {
    const bucket = integer(row.bucket),
      count = integer(row.count);
    const outcomes = {
      passed: integer(row.passed),
      failed: integer(row.failed),
      inProgress: integer(row.inProgress),
      other: integer(row.other),
    };
    const sum = Object.values(outcomes).reduce((total, value) => total + value, 0);
    if (bucket >= 24 || grouped.has(bucket) || !Number.isSafeInteger(sum) || sum !== count)
      throw new StorageError('unavailable');
    grouped.set(bucket, { count, outcomes });
  }
  return Array.from({ length: 24 }, (_, index) => ({
    from: new Date(start + index * hour).toISOString(),
    to: new Date(start + (index + 1) * hour).toISOString(),
    ...(grouped.get(index) ?? { count: 0, outcomes: { passed: 0, failed: 0, inProgress: 0, other: 0 } }),
  }));
}
