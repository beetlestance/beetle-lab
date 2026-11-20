import { expect, it } from 'vitest';
import { captureNumeric } from '../../src/application/run-metrics/values.js';
import { fixture } from './fixture.js';

async function archive() {
  const { raw } = await fixture();
  const artifact = raw.artifacts.find(({ descriptor }) => descriptor.kind === 'numeric-final');
  if (!artifact) throw Error('fixture numeric artifact missing');
  const v = JSON.parse(artifact.utf8) as { metrics: { measurement: { sourceTimeMs: number } } };
  const source = v.metrics.measurement.sourceTimeMs;
  return { v, source, scope: raw.scope };
}

it('accepts an optional native origin on the verified version 4 archive and leaves older evidence valid', async () => {
  const { v, source, scope } = await archive();
  expect(captureNumeric(v, scope)?.scenarioStartedAtMs).toBeUndefined();
  const anchored = { ...v, version: 4, timing: { testRunDurationMs: 2000 }, scenarioStartedAtMs: source + 600 };
  expect(captureNumeric(anchored, scope)?.scenarioStartedAtMs).toBe(source + 600);
  expect(() => captureNumeric(anchored, { ...scope, attemptId: 'other' })).toThrow();
});

it('rejects an impossible timestamp and the extra field on the legacy version', async () => {
  const { v, source, scope } = await archive();
  const version4 = { ...v, version: 4, timing: { testRunDurationMs: 2000 } };
  expect(() => captureNumeric({ ...version4, scenarioStartedAtMs: source - 1 }, scope)).toThrow();
  expect(() => captureNumeric({ ...version4, scenarioStartedAtMs: 1.5 }, scope)).toThrow();
  expect(() => captureNumeric({ ...v, scenarioStartedAtMs: source }, scope)).toThrow();
});
