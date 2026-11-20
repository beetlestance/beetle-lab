import type { RunMetricOverview } from '@beetle/contracts/api';
import { clock } from './format.js';
export interface RiseOrigin {
  readonly generation: number;
  readonly manifestDigest: string;
  readonly measurementSourceTimeMs: number;
  readonly scenarioStartedAtMs?: number;
}
/** Native rise times are source instants, not durations. Bind their origin before subtraction. */
export function risePosition(
  start: number,
  source: { generation: number | null; manifestDigest: string | null },
  origin: RiseOrigin | undefined,
): string {
  if (origin && source.generation === origin.generation && source.manifestDigest === origin.manifestDigest) {
    const scenarioOffset = start - (origin.scenarioStartedAtMs ?? Infinity);
    if (Number.isSafeInteger(scenarioOffset) && scenarioOffset >= 0)
      return `${clock(scenarioOffset)} into the recorded scenario`;
    const offset = start - origin.measurementSourceTimeMs;
    if (Number.isSafeInteger(offset) && offset >= 0) return `${clock(offset)} into recorded engine execution`;
  }
  return `Recorded source timestamp ${start} ms`;
}

export function measurementOrigin(value: RunMetricOverview | null | undefined): RiseOrigin | undefined {
  if (value?.availability !== 'ready') return undefined;
  const source = value.source;
  if (!source || source.numericVersion === 3) return undefined;
  const { scenarioStartedAtMs } = value;
  return scenarioStartedAtMs === undefined ? source : { ...source, scenarioStartedAtMs };
}
