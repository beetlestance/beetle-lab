import { encodeCanonicalJson } from '../json.js';
import { metricSeriesIdentity } from '../metrics/index.js';
import { metricDescriptorMatches } from './client/metric-values.js';
import { validateApi } from './validate.js';
import type { LiveMetricScope, LiveMetricSnapshot, LiveMetricSubset } from './generated/types.js';

export const LIVE_METRIC_FRAME_BYTES = 65_536;
export type LiveMetricHash = (canonicalSubset: string) => string;
export class LiveMetricError extends Error {
  constructor(readonly code: 'invalid_subset' | 'invalid_snapshot') { super('Live metric data rejected'); this.name = 'LiveMetricError'; }
}
function requireValue(value: unknown, code: LiveMetricError['code']): asserts value {
  if (!value) throw new LiveMetricError(code);
}
function detached(input: unknown, maximum: number, code: LiveMetricError['code']): unknown {
  try { return JSON.parse(encodeCanonicalJson(input, maximum)) as unknown; }
  catch { throw new LiveMetricError(code); }
}
export function captureLiveMetricSubset(input: unknown): LiveMetricSubset {
  const result = validateApi('LiveMetricSubset', detached(input, 16_384, 'invalid_subset'));
  requireValue(result.ok, 'invalid_subset');
  const subset = result.value;
  const keys = subset.selected.map(metricSeriesIdentity);
  requireValue(subset.selected.length + subset.excludedSeries <= 4600 && new Set(keys).size === keys.length && subset.selected.every((s, i) => s.ordinal === i && s.tags.phase !== 'prepare'), 'invalid_subset');
  return subset;
}
export function liveMetricSubsetText(input: unknown): string {
  return encodeCanonicalJson(captureLiveMetricSubset(input), 16_384);
}
export function liveMetricScopeMatches(actual: LiveMetricScope, expected: LiveMetricScope): boolean {
  return actual.generation === expected.generation && actual.organizationId.toLowerCase() === expected.organizationId.toLowerCase()
    && actual.workspaceId.toLowerCase() === expected.workspaceId.toLowerCase() && actual.attemptId.toLowerCase() === expected.attemptId.toLowerCase();
}
function seriesMatch(value: LiveMetricSnapshot): boolean {
  const ordinals = new Set<number>();
  return value.series.every(row => {
    const selected = value.subset.selected[row.ordinal];
    if (!selected || ordinals.has(row.ordinal) || !metricDescriptorMatches(row)
      || metricSeriesIdentity(row) !== metricSeriesIdentity(selected)) return false;
    ordinals.add(row.ordinal);
    return row.total.kind !== 'gauge' || row.total.sourceTimeMs >= value.startTimeMs && row.total.sourceTimeMs < value.endTimeMs;
  });
}
/** Hostile JSON boundary; the caller supplies its trusted synchronous SHA256 implementation. */
export function captureLiveMetricSnapshot(input: unknown, hash: LiveMetricHash): LiveMetricSnapshot {
  try {
    const result = validateApi('LiveMetricSnapshot', detached(input, LIVE_METRIC_FRAME_BYTES, 'invalid_snapshot'));
    requireValue(result.ok, 'invalid_snapshot');
    const value = result.value; const subset = captureLiveMetricSubset(value.subset);
    requireValue(value.sourceSequence >= value.publishedSequence
      && value.coalescedWindows === value.sourceSequence - value.publishedSequence
      && value.endTimeMs - value.startTimeMs === 1000 && value.publishedAtMs >= value.capturedAtMs
      && value.subsetDigest === hash(liveMetricSubsetText(subset)) && seriesMatch(value), 'invalid_snapshot');
    return { ...value, subset };
  } catch { throw new LiveMetricError('invalid_snapshot'); }
}
export function encodeLiveMetricSnapshot(input: unknown, hash: LiveMetricHash): Uint8Array {
  return new TextEncoder().encode(encodeCanonicalJson(captureLiveMetricSnapshot(input, hash), LIVE_METRIC_FRAME_BYTES));
}
export function decodeLiveMetricSnapshot(bytes: Uint8Array, hash: LiveMetricHash): LiveMetricSnapshot {
  try {
    requireValue(bytes.byteLength <= LIVE_METRIC_FRAME_BYTES, 'invalid_snapshot');
    return captureLiveMetricSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), hash);
  } catch { throw new LiveMetricError('invalid_snapshot'); }
}
