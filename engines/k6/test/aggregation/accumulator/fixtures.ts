import { MetricAccumulator, MetricStream, createK6MetricProfile } from '../../../aggregation/index.js';
import type { MetricAccumulatorOptions, MetricPoint, MetricWindow } from '../../../aggregation/index.js';
import { compiled } from '../../suite/fixtures.js';
export const signal = () => new AbortController().signal;
export const point = (metric = 'beetle_requests', value = 1, timeMs = 1000, tags: MetricPoint['tags'] = {}): MetricPoint => {
  const profile = createK6MetricProfile(compiled());
  const entry = profile.allowedSeries.find(item => item.metric === metric && item.scope !== 'prepare')!;
  return { metric, kind: entry.kind, value, timeMs, tags: { ...entry.tags, ...tags } };
};
export const marker = () => point('beetle_measure_started');
export function setup(sink?: MetricAccumulatorOptions['window']) {
  const profile = createK6MetricProfile(compiled());
  const windows: MetricWindow[] = [];
  const accumulator = new MetricAccumulator({ profile, window: sink ?? (async window => { windows.push(window); }) });
  const stream = new MetricStream({ ...profile, maximumBytes: 10_000_000, maximumRecords: 100_000,
    point: (point, signal) => accumulator.point(point, signal) });
  const declared = new Set<string>();
  async function feed(input: MetricPoint, time?: string) {
    const records: unknown[] = [];
    if (!declared.has(input.metric)) {
      records.push({ type: 'Metric', metric: input.metric, data: { type: input.kind } }); declared.add(input.metric);
    }
    records.push({ type: 'Point', metric: input.metric, data: { value: input.value,
      time: time ?? new Date(input.timeMs).toISOString(), tags: input.tags } });
    await stream.push(new TextEncoder().encode(records.map(value => JSON.stringify(value)).join('\n') + '\n'), signal());
  }
  return { profile, accumulator, stream, windows, feed };
}
export function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
