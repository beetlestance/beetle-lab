import type { RunMetricOverview } from '@beetle/contracts/api';
import { clock } from './format.js';
export interface RiseOrigin {
  readonly generation: number;
  readonly manifestDigest: string;
  readonly measurementSourceTimeMs: number;
  readonly scenarioStartedAtMs?: number;
}
type RiseSource = { generation: number | null; manifestDigest: string | null };

function matchesOrigin(source: RiseSource, origin: RiseOrigin | undefined): origin is RiseOrigin {
  return (
    origin !== undefined && source.generation === origin.generation && source.manifestDigest === origin.manifestDigest
  );
}

export function scenarioRiseOffset(start: number, source: RiseSource, origin: RiseOrigin | undefined): number | null {
  if (!matchesOrigin(source, origin) || origin.scenarioStartedAtMs === undefined) return null;
  const offset = start - origin.scenarioStartedAtMs;
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

/** Native rise times are source instants, not durations. Bind their origin before subtraction. */
export function risePosition(start: number, source: RiseSource, origin: RiseOrigin | undefined): string {
  const scenarioOffset = scenarioRiseOffset(start, source, origin);
  if (scenarioOffset !== null) return `${clock(scenarioOffset)} into the recorded scenario`;
  if (matchesOrigin(source, origin)) {
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
