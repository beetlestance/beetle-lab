import { expect, it, vi } from 'vitest';
import { captureWorkerReply } from '../../src/adapters/outbound/sqlite/worker-reply.js';

it('captures only the fixed worker control envelope before operation-specific payload validation', () => {
  const getter = vi.fn();
  const payload = Object.defineProperty({}, 'nested', { enumerable: true, get: getter });
  const input = { kind: 'result', messageId: 1, ok: true, value: payload };
  const captured = captureWorkerReply(input);
  expect(captured).not.toBe(input);
  expect(captured.kind).toBe('result');
  if (captured.kind === 'result' && captured.ok) expect(captured.value).toBe(payload);
  expect(getter).not.toHaveBeenCalled();
});

it.each([
  { kind: 'ready' }, { kind: 'startup_error', code: 'schema_newer' },
  { kind: 'result', messageId: Number.MAX_SAFE_INTEGER, ok: false, code: 'owned' },
])('accepts the closed control envelope %j', input => {
  expect(captureWorkerReply(input)).toEqual(input);
});

it.each([
  null, [], 'result', { kind: 'ready', extra: true }, { kind: 'unknown' },
  { kind: 'startup_error', code: 'invented' },
  { kind: 'result', messageId: 0, ok: true, value: null },
  { kind: 'result', messageId: 0.5, ok: true, value: null },
  { kind: 'result', messageId: Number.MAX_SAFE_INTEGER + 1, ok: true, value: null },
  { kind: 'result', messageId: 1, ok: 'true', value: null },
  { kind: 'result', messageId: 1, ok: false, code: 'invented' },
  { kind: 'result', messageId: 1, ok: true, value: null, code: 'unavailable' },
])('rejects malformed native worker control %j', input => {
  expect(() => captureWorkerReply(input)).toThrow();
});

it.each(['kind', 'messageId', 'ok', 'value'])('rejects the %s control accessor without invocation', field => {
  const getter = vi.fn();
  const input = { kind: 'result', messageId: 1, ok: true, value: null };
  Object.defineProperty(input, field, { enumerable: true, get: getter });
  expect(() => captureWorkerReply(input)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
