import type { RunMetricOverview } from '@beetle/contracts/api';
import { clock } from './format.js';
export interface RiseOrigin {
  readonly generation: number;
  readonly manifestDigest: string;
  readonly measurementSourceTimeMs: number;
}
/** Native rise times are source instants, not durations. Bind their origin before subtraction. */
export function risePosition(
  start: number,
  source: { generation: number | null; manifestDigest: string | null },
  origin: RiseOrigin | undefined,
): string {
  if (origin && source.generation === origin.generation && source.manifestDigest === origin.manifestDigest) {
    const offset = start - origin.measurementSourceTimeMs;
    if (Number.isSafeInteger(offset) && offset >= 0) return `${clock(offset)} into recorded engine execution`;
  }
  return `Recorded source timestamp ${start} ms`;
}

export function measurementOrigin(value: RunMetricOverview | null | undefined): RiseOrigin | undefined {
  if (value?.availability !== 'ready') return undefined;
  const source = value.source;
  if (!source || source.numericVersion !== 4) return undefined;
  return source;
}
