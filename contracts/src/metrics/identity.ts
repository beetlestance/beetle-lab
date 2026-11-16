import type { SeriesTotal } from './series-types.js';
/** Stable dimensions only; totals and insertion order cannot change identity. */
export function metricSeriesIdentity<T extends Pick<SeriesTotal, 'metric' | 'kind' | 'scope' | 'tags'>>(value: T): string {
  return JSON.stringify([value.metric, value.kind, value.scope, value.tags.phase ?? null,
    value.tags.request ?? null, value.tags.assertion ?? null]);
}
