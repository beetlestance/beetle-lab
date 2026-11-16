import { requireRule } from '../../../domain/namespaces/index.js';
import type { ErrorCode } from './protocol.js';
import { STORAGE_ERROR_CODES } from './protocol.js';

export type WorkerReply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; messageId: number; ok: true; value: unknown } |
  { kind: 'result'; messageId: number; ok: false; code: ErrorCode };

function fields(input: object, names: readonly string[]): void {
  const keys = Reflect.ownKeys(input);
  requireRule(keys.length === names.length && names.every(name => keys.includes(name)));
}
function data(input: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  requireRule(descriptor !== undefined && 'value' in descriptor);
  return descriptor.value as unknown;
}
function errorCode(input: unknown): ErrorCode {
  requireRule(typeof input === 'string' && STORAGE_ERROR_CODES.includes(input as ErrorCode));
  return input as ErrorCode;
}
/** Capture only fixed control fields. The selected operation owns payload bounds;
 * walking an Offer carrier here would incorrectly reapply original-root limits.
 */
export function captureWorkerReply(input: unknown): WorkerReply {
  requireRule(input !== null && typeof input === 'object');
  requireRule([Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null));
  const kind = data(input, 'kind');
  if (kind === 'ready') { fields(input, ['kind']); return { kind }; }
  if (kind === 'startup_error') {
    fields(input, ['kind', 'code']); return { kind, code: errorCode(data(input, 'code')) };
  }
  requireRule(kind === 'result');
  const messageId = data(input, 'messageId'); const ok = data(input, 'ok');
  requireRule(typeof messageId === 'number' && Number.isSafeInteger(messageId) && messageId > 0);
  requireRule(typeof ok === 'boolean');
  fields(input, ok ? ['kind', 'messageId', 'ok', 'value'] : ['kind', 'messageId', 'ok', 'code']);
  return ok ? { kind, messageId, ok, value: data(input, 'value') }
    : { kind, messageId, ok, code: errorCode(data(input, 'code')) };
}
