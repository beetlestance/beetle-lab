import { MetricReadError } from '../../../ports/run-metrics.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ApiError } from '@beetle/contracts/api';
import { SemanticError } from '../../../domain/namespaces/index.js';
import { InputByteError } from '../../../ports/input-bytes.js';
import type { InputByteErrorCode } from '../../../ports/input-bytes.js';

type Code = ApiError['code'];
const errors = {
  malformed_request: [400, 'Malformed request', false],
  unpaired: [401, 'Pairing required', false],
  forbidden: [403, 'Access denied', false],
  not_found: [404, 'Resource not found', false],
  conflict: [409, 'Version or intent conflict', false],
  body_limit: [413, 'Body limit exceeded', false],
  invalid_value: [422, 'Invalid value', false],
  search_too_broad: [422, 'Search is too broad; refine the query', false],
  search_indexing: [503, 'Search index is being prepared; retry this query', true],
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
const inputCodes = {
  invalid_input: 'malformed_request', busy: 'capacity_unavailable', capacity_unavailable: 'capacity_unavailable',
  closed: 'storage_unavailable', cancelled: 'storage_unavailable', custody_missing: 'storage_unavailable',
  integrity: 'storage_unavailable', io: 'storage_unavailable', cleanup: 'storage_unavailable',
} as const satisfies Record<InputByteErrorCode, Code>;
function inputCode(code: unknown): Code {
  return typeof code === 'string' && Object.hasOwn(inputCodes, code)
    ? inputCodes[code as InputByteErrorCode] : 'internal_error';
}
function metricCode(code: unknown): Code {
  return code === 'invalid_input' ? 'malformed_request'
    : code === 'busy' ? 'capacity_unavailable' : 'storage_unavailable';
}
function portCode(error: unknown, code: unknown): Code | undefined {
  if (error instanceof MetricReadError) return metricCode(code);
  if (error instanceof InputByteError) return inputCode(code);
  return undefined;
}
function codeFor(error: unknown, classify: ApiErrorOptions['classify']): Code {
  try {
    const code = ownCode(error);
    const port = portCode(error, code);
    if (port) return port;
    if ((error instanceof ApiFault || error instanceof SemanticError) && knownCode(code)) return code;
    const framework = typeof code === 'string' ? frameworkCodes.get(code) : undefined;
    if (framework) return framework;
    const mapped = classify?.(error);
    return knownCode(mapped) ? mapped : 'internal_error';
  } catch { return 'internal_error'; }
}
/** Fixed body factory for byte routes whose HTTP semantics require e.g.416. */
export function apiErrorResponse(code: Code): { status: number; body: ApiError } {
  const [status, message, retryable] = errors[code];
  return { status, body: { code, message, retryable, requestId: randomUUID(), fields: [] } };
}
function sendFailure(error: unknown, reply: FastifyReply, classify: ApiErrorOptions['classify']): FastifyReply {
  const result = apiErrorResponse(codeFor(error, classify));
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
  const server = Fastify({ logger: false, bodyLimit, connectionTimeout: 30_000, requestTimeout: 30_000,
    keepAliveTimeout: 5000, routerOptions: { maxParamLength: 128 },
    frameworkErrors: (error, _request, reply) => sendFailure(error, reply, classify) });
  server.server.maxConnections = 64;
  server.server.headersTimeout = 5000;
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
    const result = apiErrorResponse('not_found');
    return reply.header('Cache-Control', 'no-store').code(result.status).type('application/json').send(result.body);
  });
}
