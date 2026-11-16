import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import type { BrowserSession } from '@beetle/contracts/api';
import { apiSchemas } from '@beetle/contracts/api';
import { createApiServer } from '../api-errors.js';
import { configureSchemaCompilers } from '../schema-compilers.js';
import { registerNamespaceRoutes } from '../namespaces/index.js';
import { createLocalSession } from './index.js';
import type { LocalSessionOptions } from './index.js';

export const origin = 'http://127.0.0.1:43127';
export const host = '127.0.0.1:43127';
export const pairHeaders = { host, origin, 'content-type': 'application/json', 'x-beetle-pair': '1' };
export const authPath = '/api/v2/auth/';
export const organizationsPath = '/api/v2/organizations';
export function fixture(options: Partial<LocalSessionOptions> = {}, beforeRoutes?: (server: FastifyInstance) => void) {
  const time = { monotonic: 1000, wall: Date.UTC(2026, 0, 1) };
  const session = createLocalSession({ externalOrigin: origin,
    clocks: { monotonicNow: () => time.monotonic, wallNow: () => time.wall }, ...options });
  const server = createApiServer({ bodyLimit: 1024 });
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  beforeRoutes?.(server);
  session.registerRoutes(server);
  const list = vi.fn(async () => ({ items: [], nextCursor: null }));
  const get = vi.fn(async () => { throw new Error('unexpected get'); });
  const execute = vi.fn(async () => { throw new Error('unexpected execute'); });
  registerNamespaceRoutes(server, { reader: { list, get }, store: { execute }, authorize: session.authorize,
    digest: () => '0'.repeat(64), newId: () => '10000000-0000-4000-8000-000000000001' });
  const pair = (token = session.bootstrapToken) => server.inject({ method: 'POST', url: `${authPath}pair`,
    headers: pairHeaders, payload: { bootstrapToken: token } });
  async function paired() {
    const response = await pair();
    const view = response.json<BrowserSession>();
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    return { response, view, cookie, headers: { host, origin, cookie, 'x-beetle-csrf': view.csrfToken } };
  }
  return { server, session, time, pair, paired, list, get, execute };
}
