import Fastify from 'fastify';
import { RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AttemptKey, GenerationKey } from '../journal/index.js';
import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { AgentHttpOptions } from './types.js';
import { bodyMatches, decimal } from './auth.js';
import { requestBody, snapshotBody, sendJson, sendCapabilities } from './json.js';
import { sendError } from './errors.js';
import { RequestWork } from './work.js';
import { RequestIdentity } from './request-identity.js';
import { OfferIngress } from './offers.js';
import { liveRoute, registerLiveMetrics } from './live-metrics.js';
import { registerSources, sourceRoute } from './sources.js';
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
function ingressRoute(request: FastifyRequest): 'source' | 'live' | 'offer' | undefined {
  if (sourceRoute(request)) return 'source';
  if (liveRoute(request)) return 'live';
  if ((request.method === 'PUT' && request.routeOptions.url === '/runner/v1/attempts/:attemptId')
    || (request.method === 'POST' && request.routeOptions.url === '/runner/v1/attempts/:attemptId/cancel-original')) return 'offer';
  return undefined;
}
function ingress(server: FastifyInstance, identity: RequestIdentity, operations: RequestWork, offers: OfferIngress): void {
  server.addHook('preClose', async () => {
    const draining = operations.close();
    await Promise.all([draining, offers.close()]);
  });
  server.addHook('onError', async request => { offers.releaseRequest(request); });
  server.addHook('onResponse', async request => {
    offers.releaseRequest(request); operations.responseFinished(request);
  });
  server.addHook('onRequest', async (request, reply) => {
    const kind = ingressRoute(request);
    if (kind === 'source' || kind === 'live') reply.header('Connection', 'close');
    identity.capture(request);
    if (!kind) return;
    const scope = identity.key(request); query(request);
    if (scope.generation !== 1) throw new AgentHttpError(409, 'conflicting_digest');
    switch (kind) {
      case 'source': operations.acquireSource(request, reply); break;
      case 'live': operations.acquireLive(request, reply); break;
      case 'offer': offers.acquire(request); break;
    }
  });
}
/** Private HTTP composition; caller owns listening, installation scheduling and journal shutdown. */
export function createAgentServer(options: AgentHttpOptions): FastifyInstance {
  const identity = new RequestIdentity(options.credential, options.journalAuthority);
  const services = Object.freeze({ installation: options.installation, journal: options.journal, capabilities: options.capabilities });
  const server = Fastify({ logger: false, trustProxy: false, bodyLimit: HTTP_LIMITS.bytes, routerOptions: { querystringParser: parseQuery },
    requestTimeout: HTTP_LIMITS.requestMs, connectionTimeout: HTTP_LIMITS.requestMs, keepAliveTimeout: 5000 });
  server.server.maxConnections = HTTP_LIMITS.sockets;
  const operations = new RequestWork();
  const offers = new OfferIngress();
  ingress(server, identity, operations, offers);
  server.setErrorHandler((error, request, reply) => {
    try { sendError(reply, error, identity.scope(request), sourceRoute(request) || liveRoute(request)); } catch { reply.code(500).send(); }
  });
  server.setNotFoundHandler(() => { throw new AgentHttpError(404, 'invalid_protocol'); });
  const work = <T>(operation: () => Promise<T>) => operations.run(operation);
  const key = (request: FastifyRequest): GenerationKey => identity.key(request);
  const snapshot = async (request: FastifyRequest) => {
    const scope = key(request);
    return snapshotBody(await services.journal.get(scope as AttemptKey), scope);
  };
  server.get('/runner/v1/capabilities', async (request, reply) => {
    query(request); sendCapabilities(reply, await work(() => services.capabilities()), identity.journalAuthority);
  });
  server.put('/runner/v1/attempts/:attemptId', { bodyLimit: RUNNER_MAXIMUM_OFFER_BYTES }, async (request, reply) => {
    query(request); const scope = key(request); const body = requestBody('Offer', request.body);
    bodyMatches(scope, scope.attemptId, body);
    if (scope.generation !== 1) throw new AgentHttpError(409, 'conflicting_digest');
    const result = await offers.run(request, () => work(() => services.installation.enqueue(body)));
    if (!result.accepted) throw new AgentHttpError(result.decision.kind === 'defer' ? 429 : 422,
      'budget_unavailable', result.decision.kind === 'defer' ? 'transport' : 'never');
    sendJson(reply, 202, 'AttemptSnapshot', result.snapshot, scope);
  });
  server.post('/runner/v1/attempts/:attemptId/cancel-original', { bodyLimit: RUNNER_MAXIMUM_OFFER_BYTES }, async (request, reply) => {
    query(request); const scope = key(request); const body = requestBody('Offer', request.body);
    bodyMatches(scope, scope.attemptId, body);
    if (scope.generation !== 1) throw new AgentHttpError(409, 'conflicting_digest');
    const result = await offers.run(request, () => work(() => services.installation.cancelOriginal(body)));
    sendJson(reply, 200, 'AttemptSnapshot', result, scope);
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
  registerLiveMetrics(server, {identity, operations, read: options.liveMetrics});
  registerSources(server, { outputs: options.outputs, absences: options.absences, journal: options.journal, identity, operations });
  return server;
}
