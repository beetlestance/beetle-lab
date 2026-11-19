import type { MetricPoint } from './types.js';

export interface RequestSpan {
  readonly firstDispatchMs: number;
  readonly lastCompletionMs: number;
}

interface RequestTimes {
  first: number;
  last: number;
  count: number;
}

const times = (): RequestTimes => ({ first: Infinity, last: -Infinity, count: 0 });

function observe(series: RequestTimes, time: number) {
  series.first = Math.min(series.first, time);
  series.last = Math.max(series.last, time);
  series.count++;
}

/** Reuse native points. Keep one pair of extrema and counts per approved request label. */
export class RequestSpanTracker {
  private readonly requests = new Map<string, { dispatch: RequestTimes; completion: RequestTimes }>();
  private valid = true;

  point(point: MetricPoint): void {
    if (point.tags.phase !== 'execute' || !point.tags.request) return;
    if (point.metric !== 'beetle_requests' && point.metric !== 'http_req_duration') return;
    if (point.metric === 'beetle_requests' && point.value !== 1) {
      this.valid = false;
      return;
    }
    const label = point.tags.request;
    let request = this.requests.get(label);
    if (!request) {
      request = { dispatch: times(), completion: times() };
      this.requests.set(label, request);
    }
    observe(point.metric === 'beetle_requests' ? request.dispatch : request.completion, point.timeMs);
  }

  snapshot(): RequestSpan | undefined {
    if (!this.valid || !this.requests.size) return undefined;
    let firstDispatchMs = Infinity;
    let lastCompletionMs = -Infinity;
    for (const { dispatch, completion } of this.requests.values()) {
      if (!matched(dispatch, completion)) return undefined;
      firstDispatchMs = Math.min(firstDispatchMs, dispatch.first);
      lastCompletionMs = Math.max(lastCompletionMs, completion.last);
    }
    return Object.freeze({ firstDispatchMs, lastCompletionMs });
  }
}

function matched(dispatch: RequestTimes, completion: RequestTimes): boolean {
  return (
    dispatch.count > 0 &&
    dispatch.count === completion.count &&
    dispatch.first <= completion.first &&
    dispatch.last <= completion.last
  );
}
