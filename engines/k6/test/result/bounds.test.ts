import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import { count, fixture } from './fixtures.js';

it.each(['organizationId', 'workspaceId', 'attemptId'] as const)('rejects invalid scoped %s through shipped schema', key => {
  const input = fixture(); input.scope[key] = 'secret-canary';
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid generation=%s', generation => {
  const input = fixture(); input.scope.generation = generation;
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it('rejects extra scoped properties without discarding injected known result fields', () => {
  const input = fixture(); Object.assign(input.scope, { outcome: 'passed' });
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it.each(['secret-canary', '2026-99-01T00:00:00Z', 'a'.repeat(41)])('rejects invalid terminal time=%s', time => {
  const input = fixture(); input.terminalObservedAt = time;
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity])('rejects invalid native count=%s without leaking input', value => {
  const input = fixture(); count(input, 'beetle_assertions{assertion:a0}', value);
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it('bounds artifact count and validates paths without claiming file custody', () => {
  const input = fixture();
  const artifact = { artifactId: '00000000-0000-4000-8000-000000000004', kind: 'metrics',
    relativePath: 'evidence.json', bytes: 0, sha256: '2'.repeat(64), sealedAt: input.terminalObservedAt };
  input.artifacts = Array.from({ length: 128 }, (_, index) => ({ ...artifact, bytes: index }));
  expect(mapK6Result(input)).toMatchObject({ ok: true });
  input.artifacts.push(artifact); expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
  input.artifacts = [{ ...artifact, relativePath: '../secret-canary' }];
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it('rejects non-JSON accessors before reading evidence', () => {
  const input = fixture(); let read = false;
  Object.defineProperty(input.summary!.metrics.beetle_required_failures!.values, 'count', { enumerable: true,
    get: () => { read = true; return 0; } });
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' }); expect(read).toBe(false);
});
it('bounds copied private evidence before semantic mapping', () => {
  const input = fixture(); Object.assign(input.summary!, { unexpected: 'secret-canary'.repeat(400_000) });
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
it('rejects overflow while reconciling repeated required-failure evaluations', () => {
  const input = fixture();
  count(input, 'beetle_requests{request:r0}', Number.MAX_SAFE_INTEGER);
  for (const label of ['a0', 'a2']) {
    count(input, `beetle_assertions{assertion:${label}}`, Number.MAX_SAFE_INTEGER);
    count(input, `beetle_assertion_failures{assertion:${label}}`, Number.MAX_SAFE_INTEGER);
  }
  expect(mapK6Result(input)).toEqual({ ok: false, code: 'invalid_input' });
});
