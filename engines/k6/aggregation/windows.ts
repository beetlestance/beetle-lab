import type { AccumulatedSeries } from './snapshot.js';
import { accumulate, checkedSum } from './totals.js';
import { seriesSnapshot } from './snapshot.js';
import type { MetricWindow } from './snapshot.js';
import type { MetricPoint } from './types.js';

/** Only occupied source buckets are retained; gaps never allocate or iterate seconds. */
export class Windows {
  private readonly buckets = new Map<number, Map<string, AccumulatedSeries>>();
  private highWater = -1;
  latePoints = 0;
  constructor(private readonly maximumSeries: number) {}
  advance(timeMs: number): number {
    this.highWater = Math.max(this.highWater, timeMs);
    return Math.floor((this.highWater - 2000) / 1000) * 1000;
  }
  add(point: MetricPoint): void {
    const start = Math.floor(point.timeMs / 1000) * 1000;
    if (point.timeMs < this.highWater - 2000) { this.latePoints = checkedSum(this.latePoints, 1, true); return; }
    let bucket = this.buckets.get(start);
    if (!bucket) { bucket = new Map(); this.buckets.set(start, bucket); }
    accumulate(bucket, point, this.maximumSeries);
  }
  takeBefore(cutoff: number): MetricWindow | undefined {
    const start = [...this.buckets.keys()].sort((left, right) => left - right).find(time => time < cutoff);
    if (start === undefined) return undefined;
    const bucket = this.buckets.get(start)!;
    this.buckets.delete(start);
    return Object.freeze({ startTimeMs: start, endTimeMs: start + 1000, series: seriesSnapshot(bucket) });
  }
}
