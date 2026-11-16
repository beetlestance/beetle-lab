import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import { count, fixture, threshold } from './fixtures.js';

it('counts required definitions independently from repeated evaluations and ignores optional/readiness', () => {
  const result = mapK6Result(fixture()); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected mapping');
  expect(result.body.requiredAssertions).toEqual({ required: 2, passed: 2, failed: 0, unknown: 0 });
  expect(result.body.outcome).toBe('passed');
});
it('does not conceal a skipped assertion after a successful evaluation and later transport failure', () => {
  const input = fixture(); count(input, 'beetle_assertions{assertion:a0}', 1);
  const result = mapK6Result(input); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected mapping');
  expect(result.body.requiredAssertions).toEqual({ required: 2, passed: 1, failed: 0, unknown: 1 });
  expect(result.body).toMatchObject({ outcome: 'inconclusive', completeness: 'partial' });
});
it.each([0, null])('retains unexercised or missing evaluations=%s as unknown', value => {
  const input = fixture(); count(input, 'beetle_assertions{assertion:a0}', value);
  const result = mapK6Result(input);
  expect(result).toMatchObject({ ok: true, body: { outcome: 'inconclusive', requiredAssertions: { unknown: 1 } } });
});
it('does not infer zero failures from absent statistics', () => {
  const input = fixture(); count(input, 'beetle_assertion_failures{assertion:a0}', null);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', requiredAssertions: { unknown: 1 } } });
});
it('counts a required failing definition once while reconciling repeated failing evaluations', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_assertion_failures{assertion:a0}', 2); count(input, 'beetle_required_failures', 2);
  threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'failed', completeness: 'complete',
    requiredAssertions: { required: 2, passed: 1, failed: 1, unknown: 0 } } });
});
it.each([
  ['beetle_assertions{assertion:a0}', 3], ['beetle_assertion_failures{assertion:a0}', 3],
  ['beetle_required_failures', 1],
] as const)('makes contradictory %s=%s inconclusive execution error', (key, value) => {
  const input = fixture(); count(input, key, value);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status: 'error', reason: 'invalid_protocol' } } });
});
it('retains a known global failure while missing attribution stays unknown, not invented zero', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_assertion_failures{assertion:a0}', null);
  count(input, 'beetle_required_failures', 1); threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'failed', completeness: 'partial',
    requiredAssertions: { required: 2, failed: 0, unknown: 1 }, execution: { status: 'completed' } } });
  threshold(input, 'beetle_required_failures', 'count==0', null);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive',
    execution: { status: 'error', reason: 'engine_crash' } } });
});
it('rejects positive global required failures when no required definitions exist', () => {
  const input = fixture(); input.process.exitCode = 99;
  for (const assertion of input.suite.requests[0]!.assertions) assertion.required = false;
  count(input, 'beetle_required_failures', 1); threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    requiredAssertions: { required: 0, failed: 0, unknown: 0 }, execution: { status: 'error', reason: 'invalid_protocol' } } });
});
it('keeps an unused required request definition unknown', () => {
  const input = fixture(); count(input, 'beetle_requests{request:r0}', 0);
  count(input, 'beetle_assertions{assertion:a0}', 0); count(input, 'beetle_assertions{assertion:a2}', 0);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', requiredAssertions: { unknown: 2 } } });
});
it('permits a known ordinary failure with other assertions unknown', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_assertion_failures{assertion:a0}', 1); count(input, 'beetle_required_failures', 1);
  threshold(input, 'beetle_required_failures', 'count==0', false); count(input, 'beetle_assertions{assertion:a2}', 1);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'failed', completeness: 'partial',
    requiredAssertions: { unknown: 1, failed: 1 } } });
});
