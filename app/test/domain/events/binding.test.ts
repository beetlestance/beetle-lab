import { expect, it } from 'vitest';
import { captureEventBinding, captureEventKey } from '../../../src/domain/events/index.js';
import { binding, otherId } from './fixture.js';

it.each(['outer', 'key', 'attempt'] as const)('rejects hidden own fields at %s binding boundary', level => {
  const value = binding(); const target = level === 'outer' ? value : level === 'key' ? value.key : value.key.attempt;
  Object.defineProperty(target, 'extra', { value: 'synthetic' });
  expect(() => captureEventBinding(value)).toThrow('invalid_binding');
});
it.each(['outer', 'key', 'attempt'] as const)('rejects symbol own fields at %s binding boundary', level => {
  const value = binding(); const target = level === 'outer' ? value : level === 'key' ? value.key : value.key.attempt;
  Object.defineProperty(target, Symbol('extra'), { value: 'synthetic' });
  expect(() => captureEventBinding(value)).toThrow('invalid_binding');
});

it('captures an immutable unbound key without inventing physical authority', () => {
  const original = binding().key; const input = { ...original, attempt: { ...original.attempt } };
  const key = captureEventKey(input); input.attempt.workspaceId = otherId;
  expect(key).toEqual(original); expect(Object.isFrozen(key.attempt)).toBe(true);
  expect(Object.keys(key)).toEqual(['runId', 'attempt']); expect('journalAuthority' in key).toBe(false);
});

it('rejects binding/key accessors and proxy diagnostics without invoking value getters', () => {
  const value = binding(); let reads = 0;
  Object.defineProperty(value.key.attempt, 'workspaceId', { enumerable: true, get() { reads++; return otherId; } });
  expect(() => captureEventBinding(value)).toThrow('invalid_binding'); expect(reads).toBe(0);
  const key = new Proxy(binding().key, { getPrototypeOf() { throw new Error('synthetic private canary'); } });
  expect(() => captureEventKey(key)).toThrow('Event batch invalid_binding');
});
