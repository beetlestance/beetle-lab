import type { FastifyReply } from 'fastify';
import { encodeJson, validate, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { ProtocolName, ProtocolTypes } from '@beetle/contracts';
import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { HttpScope } from './types.js';
import { bodyMatches } from './auth.js';
export function requestBody<N extends ProtocolName>(name: N, input: unknown): ProtocolTypes[N] {
  try {
    const copy: unknown = JSON.parse(encodeJson(input, name === 'Offer' ? RUNNER_MAXIMUM_OFFER_BYTES : HTTP_LIMITS.bytes));
    const checked = validate(name, copy);
    if (checked.ok) return checked.value;
  } catch { /* Transport errors never include input or validator exception text. */ }
  throw new AgentHttpError(400, 'invalid_config');
}
function responseScope(name: ProtocolName, input: object, expected: HttpScope & { attemptId: string }): void {
  bodyMatches(expected, expected.attemptId,
    input as { organizationId: string; workspaceId: string; attemptId: string; generation: number });
  if (name === 'AttemptSnapshot') {
    const result = (input as ProtocolTypes['AttemptSnapshot']).result;
    if (result) bodyMatches(expected, expected.attemptId, result);
  }
  if (name === 'EventBatch') {
    for (const event of (input as ProtocolTypes['EventBatch']).events) {
      bodyMatches(expected, expected.attemptId, event);
      if (event.kind === 'engine.result') bodyMatches(expected, expected.attemptId, event.payload);
    }
  }
}
function capture<N extends ProtocolName>(name: N, input: unknown,
  expected?: HttpScope & { attemptId: string }): { text: string; value: ProtocolTypes[N] } {
  try {
    const text = encodeJson(input, HTTP_LIMITS.bytes); const json: unknown = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error();
    const checked = validate(name, json); if (!checked.ok) throw new Error();
    if (expected) responseScope(name, json, expected);
    return { text, value: checked.value };
  } catch { throw new AgentHttpError(500, 'invalid_protocol'); }
}
/** Capture before transport observes response fields or performs dependent service work. */
export function snapshotBody(input: unknown, expected: HttpScope & { attemptId: string }): ProtocolTypes['AttemptSnapshot'] {
  const value = capture('AttemptSnapshot', input).value;
  try { responseScope('AttemptSnapshot', value, { ...expected, generation: value.generation }); }
  catch { throw new AgentHttpError(500, 'invalid_protocol'); }
  if (value.generation !== expected.generation) throw new AgentHttpError(409, 'conflicting_digest');
  return value;
}
/** Only captured contract objects may reach Fastify's serializer selection. */
export function sendJson<N extends ProtocolName>(reply: FastifyReply, status: number, name: N, input: unknown,
  expected?: HttpScope & { attemptId: string }): void {
  const { text, value } = capture(name, input, expected);
  reply.code(status).type('application/json; charset=utf-8').serializer(() => text).send(value);
}

/** Validate and bind the one producer frame before any authority field is observed. */
export function sendCapabilities(reply: FastifyReply, input: unknown, journalAuthority: string): void {
  const { text, value } = capture('Capabilities', input);
  if (value.journalAuthority !== journalAuthority) throw new AgentHttpError(503, 'authority_mismatch');
  reply.code(200).type('application/json; charset=utf-8').serializer(() => text).send(value);
}
