import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import { count, fixture, threshold } from './fixtures.js';
import { configFor } from '../runtime/fixtures.js';

const failures = [
  ['cancelled', 'cancelled', 'cancelled'], ['deadline', 'error', 'timeout'], ['clock', 'error', 'invalid_protocol'],
  ['profile', 'error', 'setup_failed'], ['build', 'error', 'setup_failed'], ['native', 'error', 'engine_crash'],
  ['closed', 'error', 'engine_crash'], ['metrics', 'error', 'artifact_incomplete'],
  ['summary', 'error', 'artifact_incomplete'], ['cleanup', 'error', 'artifact_incomplete'],
] as const;
it.each(failures)('retains later orchestration %s despite a clean passing native exit', (code, status, reason) => {
  const input = fixture(); input.orchestrationFailure = code;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status, reason, exitCode: 0, stoppedAt: input.terminalObservedAt },
    requiredAssertions: { required: 2, passed: 2, failed: 0, unknown: 0 } },
  diagnostics: { windowCoverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } } });
});
it('prioritizes orchestration cancellation over a known required test failure', () => {
  const input = fixture(); input.orchestrationFailure = 'cancelled';
  input.process.exitCode = 99; count(input, 'beetle_assertion_failures{assertion:a0}', 1);
  count(input, 'beetle_required_failures', 1); threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status: 'cancelled', reason: 'cancelled', exitCode: 99 }, requiredAssertions: { failed: 1 } } });
});
it('keeps an authoritative deadline distinct from the native cancellation mechanism', () => {
  const input = fixture(); input.orchestrationFailure = 'deadline';
  input.process.cause = 'cancelled';
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status: 'error', reason: 'timeout', exitCode: 0 } } });
});
it('does not equate a quiescent child with quiescent overall orchestration', () => {
  const input = fixture(); input.orchestrationQuiescent = false;
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'not_quiescent' });
  input.orchestrationFailure = 'cleanup';
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'not_quiescent' });
});
it.each(['orchestrationFailure', 'orchestrationQuiescent'] as const)('requires explicit %s', field => {
  const input = fixture();
  Reflect.deleteProperty(input, field);
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it.each([undefined, true, 1, {}, [], 'arbitrary-reason'])('rejects malformed orchestration failure %s', value => {
  const input = fixture(); Object.assign(input, { orchestrationFailure: value });
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it.each([undefined, null, 0, 1, 'true', {}, []])('rejects malformed orchestration quiescence %s', value => {
  const input = fixture(); Object.assign(input, { orchestrationQuiescent: value });
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it('preserves wholly missing evidence while classifying a post-stop cleanup failure', () => {
  const input = fixture(); input.orchestrationFailure = 'cleanup';
  input.summary = null; input.metrics = null;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'missing',
    execution: { status: 'error', reason: 'artifact_incomplete', exitCode: 0 } } });
});
it('prioritizes cancellation while preserving a supported false SLO verdict', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'latency', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 10 }];
  const input = fixture(config); input.orchestrationFailure = 'cancelled'; input.process.exitCode = 99;
  threshold(input, 'http_req_duration', 'p(95)<10', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status: 'cancelled', reason: 'cancelled', exitCode: 99 },
    thresholds: [{ id: 'latency', purpose: 'slo', passed: false }] } });
});
