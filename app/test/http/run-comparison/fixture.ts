import { once } from 'node:events';
import { createServer } from 'node:net';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas, API_MAXIMUM_JSON_BYTES, createApiClient } from '@beetle/contracts/api';
import type { BrowserSession } from '@beetle/contracts/api';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../../src/adapters/inbound/http/schema-compilers.js';
import { createLocalSession } from '../../../src/adapters/inbound/http/session/index.js';
import { registerRunComparisonRoutes } from '../../../src/adapters/inbound/http/run-comparison/index.js';
import type { RunComparisonService } from '../../../src/ports/run-comparison.js';
import { classifyMetadataError } from '../../../src/bootstrap/metadata-errors.js';
export async function httpFixture(service: RunComparisonService) {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  const server = createApiServer({classify: classifyMetadataError});
  configureSchemaCompilers(server, {schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES});
  const session = createLocalSession({externalOrigin: origin}); session.registerRoutes(server);
  const routes = registerRunComparisonRoutes(server, {service, authorize: session.authorize});
  async function cleanup() {
    session.close();
    const results = await Promise.allSettled([routes.close(), server.close()]);
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason as unknown);
    if (errors.length) throw new AggregateError(errors, 'Comparison HTTP fixture cleanup failed');
  }
  try {
    await server.listen({host: '127.0.0.1', port: address.port});
    const paired = await fetch(origin + '/api/v2/auth/pair', {method: 'POST', headers: {origin, 'content-type': 'application/json',
      'x-beetle-pair': '1'}, body: JSON.stringify({bootstrapToken: session.bootstrapToken})});
    if (paired.status !== 200) throw new Error('Synthetic pairing failed');
    const body = await paired.json() as BrowserSession; const cookie = paired.headers.get('set-cookie')!.split(';')[0]!;
    const headers = {origin, cookie, 'x-beetle-csrf': body.csrfToken};
    const fetcher: typeof fetch = (input, init) => fetch(input, {...init, headers: {...headers, ...init?.headers}});
    return {server, routes, origin, headers, client: createApiClient({baseUrl: origin, fetch: fetcher}),
      close: cleanup};
  } catch (error) {
    try {await cleanup();} catch (failure) {throw new AggregateError([error, failure], 'Comparison HTTP fixture setup and cleanup failed', {cause: failure});}
    throw error;
  }
}
