import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ApiError } from '@beetle/contracts/api';
import { SemanticError } from '../../../domain/namespaces/index.js';

type Code = ApiError['code'];
const errors = {
  malformed_request: [400, 'Malformed request', false],
  unpaired: [401, 'Pairing required', false],
  forbidden: [403, 'Access denied', false],
  not_found: [404, 'Resource not found', false],
  conflict: [409, 'Version or intent conflict', false],
  body_limit: [413, 'Body limit exceeded', false],
  invalid_value: [422, 'Invalid value', false],
  capacity_unavailable: [503, 'Capacity unavailable', true],
  storage_unavailable: [503, 'Storage unavailable', true],
  cursor_expired: [409, 'Cursor expired', false],
  protected_dependency: [409, 'Protected dependency', false],
  internal_error: [500, 'Internal error', false],
  rate_limited: [429, 'Too many requests', true],
} as const satisfies Record<Code, readonly [number, ApiError['message'], boolean]>;

/** Transport owners may select only fixed public codes; raw messages are ignored. */
export class ApiFault extends Error {
  readonly statusCode: number;
  constructor(readonly code: Code) {
    super('API operation failed'); this.name = 'ApiFault';
    this.statusCode = knownCode(code) ? errors[code][0] : 500;
  }
}
export interface ApiErrorOptions {
  /** Composition maps concrete adapter errors without coupling HTTP to storage. */
  classify?: (error: unknown) => Code | undefined;
}

function ownCode(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return undefined;
  const property = Object.getOwnPropertyDescriptor(error, 'code');
  return property && 'value' in property ? property.value : undefined;
}
function knownCode(value: unknown): value is Code {
  return typeof value === 'string' && Object.hasOwn(errors, value);
}
const frameworkCodes = new Map<string, Code>([
  ['FST_ERR_CTP_BODY_TOO_LARGE', 'body_limit'],
  ['FST_ERR_VALIDATION', 'malformed_request'],
  ['FST_ERR_CTP_INVALID_JSON_BODY', 'malformed_request'],
  ['FST_ERR_CTP_EMPTY_JSON_BODY', 'malformed_request'],
  ['FST_ERR_CTP_INVALID_MEDIA_TYPE', 'malformed_request'],
  ['FST_ERR_CTP_INVALID_CONTENT_LENGTH', 'malformed_request'],
  ['FST_ERR_BAD_URL', 'malformed_request'],
  ['FST_ERR_MAX_PARAM_LENGTH', 'malformed_request'],
]);
function codeFor(error: unknown, classify: ApiErrorOptions['classify']): Code {
  try {
    const code = ownCode(error);
    if ((error instanceof ApiFault || error instanceof SemanticError) && knownCode(code)) return code;
    const framework = typeof code === 'string' ? frameworkCodes.get(code) : undefined;
    if (framework) return framework;
    const mapped = classify?.(error);
    return knownCode(mapped) ? mapped : 'internal_error';
  } catch { return 'internal_error'; }
}
function response(code: Code): { status: number; body: ApiError } {
  const [status, message, retryable] = errors[code];
  return { status, body: { code, message, retryable, requestId: randomUUID(), fields: [] } };
}
function sendFailure(error: unknown, reply: FastifyReply, classify: ApiErrorOptions['classify']): FastifyReply {
  const result = response(codeFor(error, classify));
  return reply.header('Cache-Control', 'no-store').code(result.status).type('application/json').send(result.body);
}

export interface ApiServerOptions extends ApiErrorOptions { bodyLimit?: number }
/** Constructor-level routing errors bypass setErrorHandler. Product bootstrap must
 * use this factory, then configure compilers/authentication before registering routes.
 * It creates no listener; binding/proxy/session policy remains bootstrap-owned.
 */
export function createApiServer(options: ApiServerOptions = {}): FastifyInstance {
  const bodyLimit = options.bodyLimit ?? 1_048_576;
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit < 1 || bodyLimit > 1_048_576) {
    throw new RangeError('Invalid API body limit');
  }
  const classify = options.classify;
  const server = Fastify({ logger: false, bodyLimit, routerOptions: { maxParamLength: 128 },
    frameworkErrors: (error, _request, reply) => sendFailure(error, reply, classify) });
  configureApiErrors(server, options);
  return server;
}

/** Register before resource routes. No exception values, request IDs or URLs echo.
 * A 5xx reply may follow a committed mutation: clients must replay its original
 * idempotency intent, never infer that a retryable flag proves no write occurred.
 */
export function configureApiErrors(server: FastifyInstance, options: ApiErrorOptions = {}): void {
  const classify = options.classify;
  server.setErrorHandler((error, _request, reply) => {
    return sendFailure(error, reply, classify);
  });
  server.setNotFoundHandler((_request, reply) => {
    const result = response('not_found');
    return reply.header('Cache-Control', 'no-store').code(result.status).type('application/json').send(result.body);
  });
}
