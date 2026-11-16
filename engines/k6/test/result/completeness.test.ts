import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { sealEngineResult, validate, verifyEngineResultSeal } from '@beetle/contracts';
import { mapK6Result } from '../../wrapper/result/index.js';
import { count, fixture } from './fixtures.js';

it('keeps partial windows explicit while final decision evidence stays complete', () => {
  const input = fixture(); input.metrics!.windowCoverage = { complete: false, latePoints: 2, markerDelayDroppedBuckets: 1 };
  const result = mapK6Result(input);
  expect(result).toMatchObject({ ok: true, body: { outcome: 'passed', completeness: 'complete' },
    diagnostics: { windowCoverage: { complete: false, latePoints: 2, markerDelayDroppedBuckets: 1 } } });
});
it('does not require unrelated optional statistics or timing to infer a known ordinary outcome', () => {
  const input = fixture(); input.summary!.timing.testRunDurationMs = null;
  input.summary!.metrics.http_req_duration!.values = {};
  input.summary!.metrics.http_req_duration!.missingStats = ['p(95)'];
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'passed', completeness: 'complete' } });
});
it.each(['summary', 'metrics'] as const)('does not pass without %s', key => {
  const input = fixture(); input[key] = null;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial' } });
});
it('distinguishes wholly missing decision evidence', () => {
  const input = fixture(); input.summary = null; input.metrics = null;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'missing' }, diagnostics: { windowCoverage: null } });
});
it.each([null, 0, 2])('does not pass missing/invalid marker count=%s', value => {
  const input = fixture(); count(input, 'beetle_measure_started', value);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial' } });
});
it.each(['native', 'summary'] as const)('does not upgrade partial %s collection', kind => {
  const input = fixture();
  if (kind === 'native') input.process.collection = 'partial'; else input.summary!.nativeCollection = 'partial';
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial' } });
});
it('returns a private immutable body without a seal; the shared codec accepts and verifies it', () => {
  const input = fixture(); const mapped = mapK6Result(input);
  if (!mapped.ok) throw new Error('Expected mapping');
  expect(Object.hasOwn(mapped.body, 'seal')).toBe(false);
  expect(Object.isFrozen(mapped)).toBe(true); expect(Object.isFrozen(mapped.body.requiredAssertions)).toBe(true);
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const sealed = sealEngineResult(mapped.body, input.terminalObservedAt, digest);
  if (!sealed.ok) throw new Error('Expected seal');
  expect(validate('EngineResult', sealed.value).ok).toBe(true);
  expect(verifyEngineResultSeal(sealed.value, digest).ok).toBe(true);
});
it('does not retain caller references for artifacts or window coverage', () => {
  const input = fixture(); input.artifacts.push({ artifactId: '00000000-0000-4000-8000-000000000004', kind: 'metrics',
    relativePath: 'numeric/evidence.json', bytes: 10, sha256: '2'.repeat(64), sealedAt: input.terminalObservedAt });
  const result = mapK6Result(input);
  input.artifacts[0]!.bytes = 999; input.metrics!.windowCoverage.latePoints = 99;
  expect(result).toMatchObject({ ok: true, body: { artifacts: [{ bytes: 10 }] }, diagnostics: { windowCoverage: { latePoints: 0 } } });
});
it('projects only numeric coverage fields, never unexpected private properties', () => {
  const input = fixture(); Object.assign(input.metrics!.windowCoverage, { target: 'secret-canary' });
  const result = mapK6Result(input);
  expect(JSON.stringify(result)).not.toContain('secret-canary');
  expect(result).toMatchObject({ ok: true, diagnostics: { windowCoverage: {
    complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } } });
});
