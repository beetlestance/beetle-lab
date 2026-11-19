import { isK6ExecuteRequest, summarizeK6HttpTotals } from '@beetle/contracts/k6-history';
import type { RunHistorySummary } from '@beetle/contracts/api';
import type { MetricWindow } from '../../../aggregation/index.js';

type Preview = NonNullable<RunHistorySummary['httpP95Preview']>;
type Sample = { point: Preview[number]; segment: number };
const maximumPoints = 12;

/** Keep a sparse preview of the archived execute windows with constant space. */
export class P95Preview {
  private readonly samples: Sample[] = [];
  private firstStart: number | undefined;
  private measuredThrough: number | undefined;
  private segment = 0;
  private stride = 1;

  accept(window: MetricWindow): void {
    const { startTimeMs, endTimeMs } = window;
    this.firstStart ??= startTimeMs;
    const offsetSeconds = Math.floor((startTimeMs - this.firstStart) / 1000);
    this.thin(offsetSeconds);

    const durations = window.series.filter(
      (series) => series.metric === 'http_req_duration' && isK6ExecuteRequest(series),
    );
    if (!durations.length) return;
    if (this.measuredThrough !== startTimeMs) this.segment++;
    this.measuredThrough = endTimeMs;
    if (offsetSeconds % this.stride !== 0) return;

    const p95 = summarizeK6HttpTotals(durations).httpP95;
    if (p95)
      this.samples.push({ point: { offsetSeconds, p95Ms: p95.estimate, gapBefore: false }, segment: this.segment });
  }

  private thin(offsetSeconds: number): void {
    while (Math.floor(offsetSeconds / this.stride) >= maximumPoints) {
      this.stride *= 2;
      for (let i = this.samples.length - 1; i >= 0; i--) {
        if (this.samples[i]!.point.offsetSeconds % this.stride !== 0) this.samples.splice(i, 1);
      }
    }
  }

  finish(): Preview | undefined {
    if (this.samples.length < 2) return undefined;
    return this.samples.map(({ point, segment }, index) => ({
      ...point,
      gapBefore: index > 0 && this.samples[index - 1]!.segment !== segment,
    }));
  }
}
