import { encodeJson, validate } from '@beetle/contracts';
import type { AckReceipt, ProtocolError } from '@beetle/contracts';
import { expiryCoverage } from '../../../../domain/events/index.js';
import type { EventBinding } from '../../../../domain/events/index.js';
import type { EventProblemRequest } from '../../../../ports/events.js';
import { fields, integer, invalid } from './state.js';

type Reply = { ok: true; value: unknown } | { ok: false; problem?: EventProblemRequest };
function matched(input: unknown, binding: EventBinding): ProtocolError | undefined {
  const checked = validate('ProtocolError', input);
  if (!checked.ok) return;
  const { value } = checked;
  const expected = binding.key.attempt;
  if (value.organizationId === expected.organizationId && value.workspaceId === expected.workspaceId
    && value.attemptId === expected.attemptId) return value;
}
function problem(error: Record<string, unknown>, binding: EventBinding, after: number): EventProblemRequest | undefined {
  if (error.kind !== 'protocol' || !integer(error.status, 599) || error.status < 400) return;
  const value = matched(error.protocol, binding);
  if (!value) return;
  if (error.status === 404 && value.reason === 'attempt_not_found') return { binding, after, kind: 'missing_receipt' };
  if (value.reason !== 'cursor_expired' || !value.cursorRecovery) return;
  const retainedStartSeq = value.cursorRecovery.retainedStartSeq;
  try { expiryCoverage(after, retainedStartSeq, after); }
  catch { return; }
  return { binding, after, kind: 'cursor_expired', retainedStartSeq };
}
/** Negative remote evidence is uncertainty unless its schema and exact scope match. */
export function reply(input: unknown, binding: EventBinding, after: number): Reply {
  const carrier = fields(input, ['ok'], ['value', 'error']);
  if (carrier.ok === true) {
    fields(input, ['ok', 'value']);
    return { ok: true, value: carrier.value };
  }
  if (carrier.ok !== false) return invalid();
  fields(input, ['ok', 'error']);
  const captured = fields(carrier.error, ['kind'], ['status', 'issues', 'protocol']);
  if (captured.kind === 'request') throw new Error('Invalid event custody request');
  if (!['response', 'transport', 'cancelled', 'timeout', 'protocol'].includes(captured.kind as string)) return invalid();
  // Do not expose peer diagnostics; malformed negative evidence grants no authority.
  let error: Record<string, unknown>;
  try { error = JSON.parse(encodeJson(captured, 65_536)) as Record<string, unknown>; }
  catch { return { ok: false }; }
  const evidence = problem(error, binding, after);
  return evidence ? { ok: false, problem: evidence } : { ok: false };
}
export function ackReceipt(input: unknown, binding: EventBinding, requested: number, durable: number): AckReceipt {
  const checked = validate('AckReceipt', JSON.parse(encodeJson(input, 4096)) as unknown);
  if (!checked.ok) return invalid();
  const value = checked.value;
  const expected = binding.key.attempt;
  if (value.organizationId !== expected.organizationId || value.workspaceId !== expected.workspaceId
    || value.attemptId !== expected.attemptId || value.generation !== expected.generation) return invalid();
  if (value.acknowledgedSeq < requested || value.acknowledgedSeq > durable) return invalid();
  return Object.freeze(value);
}
