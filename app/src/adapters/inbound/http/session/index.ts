import { AutomaticSessions } from './automatic.js';
import type { LocalSessionRecord, LocalSessionStore } from '../../../../ports/local-session.js';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiMessageSchemas, apiOperations } from '@beetle/contracts/api';
import type { PairBrowserRequest } from '@beetle/contracts/api';
import { ApiFault } from '../api-errors.js';
import { checkOrigin, externalOrigin, requestHeaders, sessionCookie, singleHeader } from './headers.js';
import { equalSecret, SessionAuthority } from './state.js';
import type { SessionClocks, Grant } from './state.js';

export type { SessionClocks } from './state.js';
export interface LocalSessionOptions {
  readonly externalOrigin: string;
  readonly readOnly?: true;
  readonly cookieName?: string;
  readonly automatic?: {readonly initial: LocalSessionRecord; readonly store: LocalSessionStore};
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
type OperationName = 'openLocalBrowserSession' | 'pairBrowserSession' | 'getBrowserSession' | 'logoutBrowserSession';

function routeSchema(name: OperationName) {
  const operation = apiOperations.find(candidate => candidate.name === name)!;
  return { method: operation.method, url: operation.path,
    schema: { ...('request' in operation ? { body: apiMessageSchemas[operation.request] } : {}),
      response: { [operation.successStatus]: apiMessageSchemas[operation.response] } } };
}
function jsonObject(value: object): object { return JSON.parse(encodeJson(value, 1024)) as object; }
function cookie(value: string, secure: boolean, name: string, clear = false): string {
  return `${name}=${value}; Path=/api/v2/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${secure ? '; Secure' : ''}`;
}
function requestCookie(request: FastifyRequest, name: string): string | undefined { return sessionCookie(requestHeaders(request), name); }
function checkExchange(headers: ReadonlyMap<string, readonly string[]>, name: 'x-beetle-pair' | 'x-beetle-local'): void {
  const contentType = singleHeader(headers, 'content-type');
  if (singleHeader(headers, name) !== '1' ||
    !contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) throw new ApiFault('forbidden');
}

/** No listener, logging, CORS, timers or global hooks. Composition must pass
 * authorize explicitly to every protected route plugin before registering it.
 */
export function createLocalSession(options: LocalSessionOptions): LocalSession {
  const origin = externalOrigin(options.externalOrigin);
  const name = cookieName(options);
  const view = (session: object) => jsonObject({...session, ...(options.readOnly ? {readOnly: true} : {}), ...(options.automatic ? {accessMode: 'automatic'} : {})});
  const authority = new SessionAuthority(options.clocks ?? { monotonicNow: () => performance.now(), wallNow: () => Date.now() });
  const automatic = options.automatic ? new AutomaticSessions(authority, options.automatic.store, options.automatic.initial) : undefined;
  const authenticate = (value: string | undefined, logoutReplay = false) => automatic ? automatic.authenticate(value, logoutReplay) : authority.authenticate(value);
  const guard = (exchange?: 'pair' | 'local', logoutReplay = false): onRequestAsyncHookHandler => async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const headers = requestHeaders(request);
    const mutation = request.method !== 'GET' && request.method !== 'HEAD';
    checkOrigin(headers, origin, mutation);
    if (exchange) {
      admitExchange(exchange, headers, authority, automatic !== undefined); return;
    }
    const view = authenticate(sessionCookie(headers, name), logoutReplay);
    if (mutation && !equalSecret(singleHeader(headers, 'x-beetle-csrf'), view.csrfToken)) throw new ApiFault('forbidden');
  };
  const authorize = guard();
  const registerRoutes = (server: FastifyInstance): void => {
    server.route({ ...routeSchema('openLocalBrowserSession'), onRequest: guard('local'), handler: async (_request, reply) => {
      let grant: Grant;
      try {grant = await automatic!.grant(); automatic!.authenticate(grant.cookie);} catch (error) {throw localAccessError(error);}
      return reply.header('Set-Cookie', cookie(grant.cookie, origin.secure, name)).send(view(grant.view));
    } });
    server.route({ ...routeSchema('pairBrowserSession'), onRequest: guard('pair'), handler: async (request, reply) => {
      const grant = authority.pair((request.body as PairBrowserRequest).bootstrapToken);
      return reply.header('Set-Cookie', cookie(grant.cookie, origin.secure, name)).send(view(grant.view));
    } });
    server.route({ ...routeSchema('getBrowserSession'), onRequest: authorize, handler: async request => {
      return view(authenticate(requestCookie(request, name)));
    } });
    server.route({ ...routeSchema('logoutBrowserSession'), onRequest: guard(undefined, true), handler: async (request, reply) => {
      if (automatic) {
        try {await automatic.logout(requestCookie(request, name)); automatic.confirmLogout();} catch (error) {throw localAccessError(error);}
      }
      else authority.logout(requestCookie(request, name));
      return reply.header('Set-Cookie', cookie('', origin.secure, name, true)).send(jsonObject({ loggedOut: true }));
    } });
  };
  return Object.freeze({ bootstrapToken: authority.bootstrapToken, authorize, registerRoutes, close: () => {automatic?.close(); authority.close();} });
}

export { externalOrigin as captureLocalExternalOrigin } from './headers.js';

function localAccessError(error: unknown): unknown {
  return error instanceof ApiFault && error.code === 'unpaired' ? new ApiFault('storage_unavailable') : error;
}

function admitExchange(exchange: 'pair' | 'local', headers: ReadonlyMap<string, readonly string[]>, authority: SessionAuthority, automatic: boolean): void {
  checkExchange(headers, exchange === 'pair' ? 'x-beetle-pair' : 'x-beetle-local');
  if (exchange === 'local' && !automatic) throw new ApiFault('unpaired');
  if (exchange === 'pair' && automatic) throw new ApiFault('forbidden');
  try {authority.admitPair();} catch (error) {throw exchange === 'local' ? localAccessError(error) : error;}
}

function cookieName(options: LocalSessionOptions): string {
  if (options.readOnly !== undefined && options.readOnly !== true) throw new TypeError('Invalid session mode');
  if (!options.readOnly && options.cookieName !== undefined) throw new TypeError('Historical cookie only');
  const name = options.cookieName ?? 'beetle_session';
  if (!/^[a-z0-9_]{1,64}$/.test(name)) throw new TypeError('Invalid cookie name'); return name;
}
