import { expect, it } from 'vitest';
import { summaryProjection } from '../../runtime/summary.js';
import { validateSummary } from '../../wrapper/collection/validation.js';
import { compiled } from '../suite/fixtures.js';

it('projects measured native keys only, exact native quantiles and closed native timing', () => {
  const suite = compiled();
  const projected: unknown = JSON.parse(summaryProjection(suite, { state: { testRunDurationMs: 9000, secret: 'canary' }, metrics: {
    http_reqs: { values: { count: 10000, rate: 999 } },
    'http_reqs{phase:execute}': { values: { count: 6, rate: 2 / 3 } },
    'http_req_duration{phase:execute}': { values: { avg: 1, 'p(95)': 123 } },
    'http_req_failed{phase:execute}': { values: { rate: 0.25, passes: 1, fails: 3 } },
    vus: { values: { value: 2, min: 1, max: 5 } },
  } }));
  const evidence = validateSummary(projected, suite);
  expect(evidence.timing).toEqual({ testRunDurationMs: 9000 });
  expect(evidence.metrics.http_reqs).toMatchObject({ nativeKey: 'http_reqs{phase:execute}', scope: 'execute',
    provenance: { source: 'native', counterRateDenominator: 'engine-duration', rateDenominator: null }, values: { count: 6, rate: 2 / 3 } });
  expect(evidence.metrics.http_req_failed!.provenance).toEqual({ source: 'native', counterRateDenominator: null, rateDenominator: 'samples' });
  expect(evidence.metrics.http_req_duration!.values['p(95)']).toBe(123);
  expect(evidence.metrics.vus!.scope).toBe('engine');
  expect(JSON.stringify(projected)).not.toContain('canary');
});
it.each([undefined, null, -1, Infinity, NaN, '9000'])('keeps unsupported native duration %s unknown', duration => {
  const suite = compiled();
  const evidence = validateSummary(JSON.parse(summaryProjection(suite, { state: { testRunDurationMs: duration } })), suite);
  expect(evidence.timing.testRunDurationMs).toBeNull();
  expect(evidence.metrics.http_reqs!.values).toEqual({});
});
it.each(['legacy', 'timingExtra', 'timingBad', 'nativeKey', 'scope', 'denominator', 'provenanceExtra'])('strictly rejects %s v2 corruption', kind => {
  const suite = compiled();
  const json = JSON.parse(summaryProjection(suite, {})) as { version: number; timing: Record<string, unknown>;
    metrics: Record<string, { nativeKey: string; scope: string; provenance: Record<string, unknown> }> };
  if (kind === 'legacy') json.version = 1;
  if (kind === 'timingExtra') json.timing.extra = 1;
  if (kind === 'timingBad') json.timing.testRunDurationMs = -1;
  if (kind === 'nativeKey') json.metrics.http_reqs!.nativeKey = 'http_reqs';
  if (kind === 'scope') json.metrics.vus!.scope = 'execute';
  if (kind === 'denominator') json.metrics.http_reqs!.provenance.counterRateDenominator = null;
  if (kind === 'provenanceExtra') json.metrics.http_reqs!.provenance.extra = true;
  expect(() => validateSummary(json, suite)).toThrow('invalid');
});
