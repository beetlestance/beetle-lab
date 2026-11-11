import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { captureTargetRuntimeReport, decodeTargetRuntimeReport, encodeTargetRuntimeReport,
  targetMetricNames, TARGET_RUNTIME_REPORT_BYTES } from './index.js';
function fixture() {
  return JSON.parse(readFileSync(new URL('../../fixtures/valid/target-runtime-report.json', import.meta.url), 'utf8')) as {
    format: string; version: number; scope: string; limited: boolean; missed: number;
    samples: {observedAt: string; phase: string; status: string; reason: string | null; values: Record<string, number | null>}[];
  };
}
it('round-trips one immutable detached report with actual zero and explicit missing values', () => {
  const source = fixture(); source.samples[0]!.values.rss = 0;
  const report = captureTargetRuntimeReport(source); source.samples[0]!.values.rss = 999;
  expect(report.samples[0]?.values.rss).toBe(0); expect(report.samples[0]?.values.heapAlloc).toBeNull();
  expect(Object.keys(report.samples[0]!.values).sort()).toEqual([...targetMetricNames].sort());
  expect(Object.isFrozen(report.samples)).toBe(true); expect(Object.isFrozen(report.samples[0]!.values)).toBe(true);
  expect(decodeTargetRuntimeReport(encodeTargetRuntimeReport(report))).toEqual(report);
});
it('permits unavailable observations only with a fixed reason, all-null values and accurate missed count', () => {
  const source = fixture(); const sample = source.samples[0]!; sample.status = 'unavailable'; sample.reason = 'timeout';
  for (const key of targetMetricNames) sample.values[key] = null;
  source.missed = 1; expect(captureTargetRuntimeReport(source).samples[0]?.values.rss).toBeNull();
  source.missed = 0; expect(() => captureTargetRuntimeReport(source)).toThrow();
  source.missed = 2; expect(() => captureTargetRuntimeReport(source)).toThrow();
  source.limited = true; expect(captureTargetRuntimeReport(source).missed).toBe(2);
  sample.values.rss = 1; expect(() => captureTargetRuntimeReport(source)).toThrow();
});
it.each([NaN, Infinity, -1])('rejects malformed source numbers rather than manufacturing zero (%s)', value => {
  const source = fixture(); source.samples[0]!.values.rss = value; expect(() => captureTargetRuntimeReport(source)).toThrow();
});
it('rejects unknown fields, omitted keys, contradictory reasons and unsupported report versions', () => {
  const invalid: unknown[] = [];
  const unknown = fixture(); unknown.samples[0]!.values.secret = 1; invalid.push(unknown);
  const missing = fixture(); delete missing.samples[0]!.values.rss; invalid.push(missing);
  const reason = fixture(); reason.samples[0]!.reason = 'http'; invalid.push(reason);
  const future = fixture(); future.version = 2; invalid.push(future);
  const scope = fixture(); scope.scope = 'engine'; invalid.push(scope);
  for (const source of invalid) expect(() => captureTargetRuntimeReport(source)).toThrow();
});
it('bounds sample count, raw bytes, UTF8 and observation timestamps', () => {
  const source = fixture(); source.samples = Array.from({length: 256}, () => structuredClone(source.samples[0]!));
  expect(captureTargetRuntimeReport(source).samples).toHaveLength(256);
  source.samples.push(structuredClone(source.samples[0]!)); expect(() => captureTargetRuntimeReport(source)).toThrow();
  expect(() => decodeTargetRuntimeReport(new Uint8Array(TARGET_RUNTIME_REPORT_BYTES + 1))).toThrow(expect.objectContaining({code: 'body_limit'}));
  expect(() => decodeTargetRuntimeReport(Uint8Array.of(255))).toThrow(expect.objectContaining({code: 'invalid_json'}));
  const timestamp = fixture(); timestamp.samples[0]!.observedAt = '2026-01-01T01:00:00+01:00';
  expect(() => captureTargetRuntimeReport(timestamp)).toThrow();
});
it('rejects accessor/prototype serialization without invoking arbitrary code', () => {
  let invoked = false; const source = fixture();
  Object.defineProperty(source, 'samples', {get() {invoked = true; return [];}});
  expect(() => captureTargetRuntimeReport(source)).toThrow(); expect(invoked).toBe(false);
  const custom = fixture(); Object.setPrototypeOf(custom, {toJSON() {invoked = true; return {};}});
  expect(() => captureTargetRuntimeReport(custom)).toThrow(); expect(invoked).toBe(false);
});
