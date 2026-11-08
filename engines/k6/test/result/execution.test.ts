import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import type { ProcessCause } from '../../wrapper/process/index.js';
import { count, fixture, threshold } from './fixtures.js';

it.each(['quiescent', 'groupAbsent', 'stdioClosed'] as const)('does not seal without %s', field => {
  const input = fixture(); input.process[field] = false;
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'not_quiescent' });
});
it('does not seal an unknown owned child', () => {
  const input = fixture(); input.process.state = 'unknown';
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'not_quiescent' });
});
it('allows a confirmed never-started error without inventing group absence', () => {
  const input = fixture(); input.process = { ...input.process, spawned: false, state: 'not_started',
    groupAbsent: false, stdioClosed: false, exitCode: null, cause: 'profile' };
  input.summary = null; input.metrics = null;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'missing',
    execution: { status: 'error', reason: 'setup_failed', exitCode: null } } });
});
it.each([
  ['cancelled', 'cancelled', 'cancelled'], ['deadline', 'error', 'timeout'], ['clock', 'error', 'invalid_protocol'],
  ['profile', 'error', 'setup_failed'], ['spawn', 'error', 'setup_failed'], ['child_error', 'error', 'engine_crash'],
  ['metric_limit', 'error', 'output_limit'], ['diagnostic_limit', 'error', 'output_limit'],
  ['stream', 'error', 'artifact_incomplete'], ['sink', 'error', 'artifact_incomplete'],
  ['descendants', 'error', 'engine_crash'], ['drain_timeout', 'error', 'engine_crash'], ['closed', 'error', 'engine_crash'],
] as const)('maps native cause %s without making it a completed test result', (cause, status, reason) => {
  const input = fixture(); input.process.cause = cause satisfies ProcessCause;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', execution: { status, reason } } });
});
it.each([null, 1, 99, 104, 137])('does not pass unexplained native exit %s', exitCode => {
  const input = fixture(); input.process.exitCode = exitCode;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', execution: { status: 'error', reason: 'engine_crash' } } });
});
it('does not infer OOM from a child signal or137', () => {
  const input = fixture(); input.process.signal = 'SIGKILL'; input.process.exitCode = null;
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', execution: { reason: 'engine_crash' } } });
});
it('retains the supplied terminal confirmation time and native code', () => {
  const input = fixture(); input.terminalObservedAt = '2026-02-01T02:03:04Z';
  const result = mapK6Result(input); expect(result).toMatchObject({ ok: true, body: { execution: {
    status: 'completed', exitCode: 0, stoppedAt: input.terminalObservedAt } } });
});
it('prioritizes positive execution-health evidence over a known assertion failure', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_assertion_failures{assertion:a0}', 1); count(input, 'beetle_required_failures', 1);
  threshold(input, 'beetle_required_failures', 'count==0', false);
  count(input, 'beetle_execution_failures', 1); threshold(input, 'beetle_execution_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', execution: { status: 'error', reason: 'engine_crash' } } });
});
it.each(['beetle_required_failures', 'beetle_execution_failures'])('rejects contradictory %s health count/verdict', metric => {
  const input = fixture(); threshold(input, metric, 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', execution: { reason: 'invalid_protocol' } } });
});
it.each(['beetle_required_failures', 'beetle_execution_failures'])('does not pass without known %s guard', metric => {
  const input = fixture(); threshold(input, metric, 'count==0', null);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial' } });
});
