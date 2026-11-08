import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import { count, fixture, threshold } from './fixtures.js';

it('retains the known required-failure lower bound even when another term is missing', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_assertion_failures{assertion:a0}', 2);
  count(input, 'beetle_assertion_failures{assertion:a2}', null);
  count(input, 'beetle_required_failures', 1); threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status: 'error', reason: 'invalid_protocol' } } });
});
it('rejects failures above request attempts even when evaluation counts are missing', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_requests{request:r0}', 0);
  count(input, 'beetle_assertions{assertion:a0}', null); count(input, 'beetle_assertions{assertion:a2}', null);
  count(input, 'beetle_assertion_failures{assertion:a0}', 1);
  count(input, 'beetle_required_failures', 1); threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'inconclusive', completeness: 'partial',
    execution: { status: 'error', reason: 'invalid_protocol' } } });
});
it('does not claim an exact mismatch when the known lower bound fits the global total', () => {
  const input = fixture(); input.process.exitCode = 99;
  count(input, 'beetle_assertion_failures{assertion:a0}', 1);
  count(input, 'beetle_assertion_failures{assertion:a2}', null);
  count(input, 'beetle_required_failures', 2); threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toMatchObject({ ok: true, body: { outcome: 'failed', completeness: 'partial',
    requiredAssertions: { failed: 1, unknown: 1 }, execution: { status: 'completed' } } });
});
it('bounds the known subtotal even after a missing term makes the exact sum unknown', () => {
  const input = fixture(); input.suite.requests[0]!.assertions[1]!.required = true;
  count(input, 'beetle_requests{request:r0}', Number.MAX_SAFE_INTEGER);
  for (const label of ['a0', 'a1', 'a2']) {
    count(input, `beetle_assertions{assertion:${label}}`, Number.MAX_SAFE_INTEGER);
    count(input, `beetle_assertion_failures{assertion:${label}}`, label === 'a0' ? null : Number.MAX_SAFE_INTEGER);
  }
  count(input, 'beetle_required_failures', Number.MAX_SAFE_INTEGER);
  threshold(input, 'beetle_required_failures', 'count==0', false);
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
