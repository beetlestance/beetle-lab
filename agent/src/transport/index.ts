import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AttemptKey, GenerationKey } from '../journal/index.js';
import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { AgentHttpOptions, HttpScope } from './types.js';
import { authenticate, credentialHash, scopeFromHeaders, attemptId, bodyMatches, decimal } from './auth.js';
import { requestBody, sendJson } from './json.js';
import { sendError } from './errors.js';
import { RequestWork } from './work.js';
export { AgentHttpError, HTTP_LIMITS } from './types.js';
export type { AgentHttpOptions } from './types.js';

function parseQuery(text: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  if (text.length > 128) return { invalidQuery: 'limit' };
  for (const [key, value] of new URLSearchParams(text)) {
    const before = result[key];
    if (typeof before === 'string') result[key] = [before, value];
    else if (before) before.push(value);
    else result[key] = value;
  }
  return result;
}
function query(request: FastifyRequest, cursor = false): number {
  const raw = request.query;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AgentHttpError(400, 'invalid_protocol');
  const keys = Object.keys(raw);
  if (!cursor) { if (keys.length) throw new AgentHttpError(400, 'invalid_protocol'); return 0; }
  if (keys.join(',') !== 'after') throw new AgentHttpError(400, 'invalid_protocol');
  return decimal((raw as Record<string, unknown>).after, 0);
}
/** Private HTTP composition; caller owns listening, installation scheduling and journal shutdown. */
export function createAgentServer(options: AgentHttpOptions): FastifyInstance {
  const expected = credentialHash(options.credential);
  const services = Object.freeze({ installation: options.installation, journal: options.journal, capabilities: options.capabilities });
  const server = Fastify({ logger: false, trustProxy: false, bodyLimit: HTTP_LIMITS.bytes, routerOptions: { querystringParser: parseQuery },
    requestTimeout: HTTP_LIMITS.requestMs, connectionTimeout: HTTP_LIMITS.requestMs, keepAliveTimeout: 5000 });
  server.server.maxConnections = HTTP_LIMITS.sockets;
  const scopes = new WeakMap<FastifyRequest, HttpScope>(); const operations = new RequestWork();
  server.addHook('preClose', async () => { await operations.close(); });
  server.addHook('onRequest', async request => {
    const raw = authenticate(request, expected);
    if ((request.raw.url?.length ?? 0) > 2048) throw new AgentHttpError(414, 'invalid_protocol');
    if (request.routeOptions.url !== '/runner/v1/capabilities') scopes.set(request, scopeFromHeaders(raw));
  });
  server.setErrorHandler((error, request, reply) => {
    try { sendError(reply, error, scopes.get(request)); } catch { reply.code(500).send(); }
  });
  server.setNotFoundHandler(() => { throw new AgentHttpError(404, 'invalid_protocol'); });
  const work = <T>(operation: () => Promise<T>) => operations.run(operation);
  const key = (request: FastifyRequest): GenerationKey => {
    const scope = scopes.get(request);
    if (!scope) throw new AgentHttpError(403, 'invalid_protocol');
    return { ...scope, attemptId: attemptId(request.params) };
  };
  const snapshot = async (request: FastifyRequest) => {
    const scope = key(request); const value = await services.journal.get(scope as AttemptKey);
    if (value.generation !== scope.generation) throw new AgentHttpError(409, 'conflicting_digest');
    return value;
  };
  server.get('/runner/v1/capabilities', async (request, reply) => {
    query(request); sendJson(reply, 200, 'Capabilities', await work(() => services.capabilities()));
  });
  server.put('/runner/v1/attempts/:attemptId', async (request, reply) => {
    query(request); const scope = key(request); const body = requestBody('Offer', request.body);
    bodyMatches(scope, scope.attemptId, body);
    if (scope.generation !== 1) throw new AgentHttpError(409, 'conflicting_digest');
    const result = await work(() => services.installation.enqueue(body));
    if (!result.accepted) throw new AgentHttpError(result.decision.kind === 'defer' ? 429 : 422,
      'budget_unavailable', result.decision.kind === 'defer' ? 'transport' : 'never');
    sendJson(reply, 202, 'AttemptSnapshot', result.snapshot, scope);
  });
  server.get('/runner/v1/attempts/:attemptId', async (request, reply) => {
    query(request); sendJson(reply, 200, 'AttemptSnapshot', await work(() => snapshot(request)), key(request));
  });
  server.post('/runner/v1/attempts/:attemptId/cancel', async (request, reply) => {
    query(request); const scope = key(request); bodyMatches(scope, scope.attemptId, requestBody('Cancellation', request.body));
    sendJson(reply, 200, 'AttemptSnapshot', await work(() => services.installation.cancel(scope)), scope);
  });
  server.get('/runner/v1/attempts/:attemptId/events', async (request, reply) => {
    const after = query(request, true); const scope = key(request);
    const value = await work(async () => { await snapshot(request); return services.journal.readEvents(scope, after); });
    sendJson(reply, 200, 'EventBatch', value, scope);
  });
  server.post('/runner/v1/attempts/:attemptId/ack', async (request, reply) => {
    query(request); const scope = key(request); const body = requestBody('Ack', request.body); bodyMatches(scope, scope.attemptId, body);
    sendJson(reply, 200, 'AckReceipt', await work(() => services.journal.acknowledge(body)), scope);
  });
  return server;
}
