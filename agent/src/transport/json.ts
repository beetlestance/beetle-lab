import type { FastifyReply } from 'fastify';
import { encodeJson, validate } from '@beetle/contracts';
import type { ProtocolName, ProtocolTypes } from '@beetle/contracts';
import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { HttpScope } from './types.js';
import { bodyMatches } from './auth.js';
export function requestBody<N extends ProtocolName>(name: N, input: unknown): ProtocolTypes[N] {
  try {
    const copy: unknown = JSON.parse(encodeJson(input, HTTP_LIMITS.bytes));
    const checked = validate(name, copy);
    if (checked.ok) return checked.value;
  } catch { /* Transport error is deliberately independent of input/validator exception text. */ }
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
/** Capture bounded object bytes before Fastify can choose a string/stream serializer bypass. */
export function sendJson<N extends ProtocolName>(reply: FastifyReply, status: number, name: N, input: unknown,
  expected?: HttpScope & { attemptId: string }): void {
  let json: unknown; let text: string;
  try {
    text = encodeJson(input, HTTP_LIMITS.bytes); json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json) || !validate(name, json).ok) throw new Error();
    if (expected) responseScope(name, json, expected);
  } catch { throw new AgentHttpError(500, 'invalid_protocol'); }
  reply.code(status).type('application/json; charset=utf-8').serializer(() => text).send(json);
}
