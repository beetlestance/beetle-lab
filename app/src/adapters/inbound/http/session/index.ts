import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiMessageSchemas, apiOperations } from '@beetle/contracts/api';
import type { PairBrowserRequest } from '@beetle/contracts/api';
import { ApiFault } from '../api-errors.js';
import { checkOrigin, externalOrigin, requestHeaders, sessionCookie, singleHeader } from './headers.js';
import { equalSecret, SessionAuthority } from './state.js';
import type { SessionClocks } from './state.js';

export type { SessionClocks } from './state.js';
export interface LocalSessionOptions {
  readonly externalOrigin: string;
  /** Trusted test clocks only; cryptographic randomness is never injectable. */
  readonly clocks?: SessionClocks;
}
export interface LocalSession {
  /** Secret for explicit local startup output only. Never log through HTTP. */
  readonly bootstrapToken: string;
  readonly authorize: onRequestAsyncHookHandler;
  readonly registerRoutes: (server: FastifyInstance) => void;
  readonly close: () => void;
}
type OperationName = 'pairBrowserSession' | 'getBrowserSession' | 'logoutBrowserSession';

function routeSchema(name: OperationName) {
  const operation = apiOperations.find(candidate => candidate.name === name)!;
  return { method: operation.method, url: operation.path,
    schema: { ...('request' in operation ? { body: apiMessageSchemas[operation.request] } : {}),
      response: { [operation.successStatus]: apiMessageSchemas[operation.response] } } };
}
function jsonObject(value: object): object { return JSON.parse(encodeJson(value, 1024)) as object; }
function cookie(value: string, secure: boolean, clear = false): string {
  return `beetle_session=${value}; Path=/api/v2/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${secure ? '; Secure' : ''}`;
}
function requestCookie(request: FastifyRequest): string | undefined { return sessionCookie(requestHeaders(request)); }
function checkPair(headers: ReadonlyMap<string, readonly string[]>): void {
  const contentType = singleHeader(headers, 'content-type');
  if (singleHeader(headers, 'x-beetle-pair') !== '1' ||
    !contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) throw new ApiFault('forbidden');
}

/** No listener, logging, CORS, timers or global hooks. Composition must pass
 * authorize explicitly to every protected route plugin before registering it.
 */
export function createLocalSession(options: LocalSessionOptions): LocalSession {
  const origin = externalOrigin(options.externalOrigin);
  const authority = new SessionAuthority(options.clocks ?? { monotonicNow: () => performance.now(), wallNow: () => Date.now() });
  const guard = (pair: boolean): onRequestAsyncHookHandler => async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const headers = requestHeaders(request);
    const mutation = request.method !== 'GET' && request.method !== 'HEAD';
    checkOrigin(headers, origin, mutation);
    if (pair) { checkPair(headers); authority.admitPair(); return; }
    const view = authority.authenticate(sessionCookie(headers));
    if (mutation && !equalSecret(singleHeader(headers, 'x-beetle-csrf'), view.csrfToken)) throw new ApiFault('forbidden');
  };
  const authorize = guard(false);
  const registerRoutes = (server: FastifyInstance): void => {
    server.route({ ...routeSchema('pairBrowserSession'), onRequest: guard(true), handler: async (request, reply) => {
      const grant = authority.pair((request.body as PairBrowserRequest).bootstrapToken);
      return reply.header('Set-Cookie', cookie(grant.cookie, origin.secure)).send(jsonObject(grant.view));
    } });
    server.route({ ...routeSchema('getBrowserSession'), onRequest: authorize, handler: async request => {
      return jsonObject(authority.authenticate(requestCookie(request)));
    } });
    server.route({ ...routeSchema('logoutBrowserSession'), onRequest: authorize, handler: async (request, reply) => {
      authority.logout(requestCookie(request));
      return reply.header('Set-Cookie', cookie('', origin.secure, true)).send(jsonObject({ loggedOut: true }));
    } });
  };
  return Object.freeze({ bootstrapToken: authority.bootstrapToken, authorize, registerRoutes, close: () => authority.close() });
}
