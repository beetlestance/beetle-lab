import { validateApi } from '../validate.js';
export interface MetricPosition {
  organizationId: string; workspaceId: string; runId: string; attemptId: string; manifestDigest: string;
}
export interface SeriesPosition extends MetricPosition { nextOrdinal: number }
export interface SamplesPosition extends MetricPosition { seriesOrdinal: number; fromTimeMs: number; toTimeMs: number; beforeWindow: number }
const safe = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max && !Object.is(n, -0);
function common(p: MetricPosition): readonly string[] {
  const ids = [p.organizationId, p.workspaceId, p.runId, p.attemptId];
  if (!ids.every(id => validateApi('Uuid', id).ok) || !/^[a-f0-9]{64}$/.test(p.manifestDigest)) throw new Error('cursor');
  return ids.map(id => id.toLowerCase()).concat(p.manifestDigest);
}
function encode(tuple: readonly unknown[]): string {
  const value = btoa(JSON.stringify(tuple)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (value.length > 512) throw new Error('cursor'); return value;
}
function decode(value: string, lane: string, length: number): unknown[] {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('cursor');
  const tuple: unknown = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
  if (!Array.isArray(tuple) || tuple.length !== length || tuple[0] !== lane) throw new Error('cursor'); return tuple;
}
export function encodeRunMetricSeriesCursor(p: SeriesPosition): string {
  if (!safe(p.nextOrdinal, 4095) || p.nextOrdinal < 1) throw new Error('cursor');
  return encode(['metric-series-v1', ...common(p), p.nextOrdinal]);
}
export function encodeRunMetricSamplesCursor(p: SamplesPosition): string {
  if (!safe(p.seriesOrdinal, 4095) || !safe(p.beforeWindow, 65536) || !safe(p.fromTimeMs, 8640000000000000)
    || !safe(p.toTimeMs, 8640000000000000) || p.fromTimeMs >= p.toTimeMs) throw new Error('cursor');
  return encode(['metric-samples-v1', ...common(p), p.seriesOrdinal, p.fromTimeMs, p.toTimeMs, p.beforeWindow]);
}
function position(t: unknown[]): MetricPosition {
  if (![1, 2, 3, 4, 5].every(i => typeof t[i] === 'string')) throw new Error('cursor');
  return {organizationId: t[1] as string, workspaceId: t[2] as string, runId: t[3] as string,
    attemptId: t[4] as string, manifestDigest: t[5] as string};
}
export function captureRunMetricSeriesCursor(input: string): SeriesPosition {
  const t = decode(input, 'metric-series-v1', 7); const p = {...position(t), nextOrdinal: t[6] as number};
  if (encodeRunMetricSeriesCursor(p) !== input) throw new Error('cursor'); return p;
}
export function captureRunMetricSamplesCursor(input: string): SamplesPosition {
  const t = decode(input, 'metric-samples-v1', 10); const p = {...position(t), seriesOrdinal: t[6] as number,
    fromTimeMs: t[7] as number, toTimeMs: t[8] as number, beforeWindow: t[9] as number};
  if (encodeRunMetricSamplesCursor(p) !== input) throw new Error('cursor'); return p;
}
