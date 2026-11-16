import { once } from 'node:events';
import { createServer } from 'node:net';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas, API_MAXIMUM_JSON_BYTES } from '@beetle/contracts/api';
import type { BrowserSession } from '@beetle/contracts/api';
import { createApiServer } from '../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../src/adapters/inbound/http/schema-compilers.js';
import { createLocalSession } from '../../src/adapters/inbound/http/session/index.js';
import { registerRunArtifactRoutes } from '../../src/adapters/inbound/http/run-artifacts/index.js';
import type { RunArtifactsReader } from '../../src/ports/run-artifacts.js';
import type { OutputByteStore } from '../../src/ports/output-bytes.js';
import { classifyMetadataError } from '../../src/bootstrap/metadata-errors.js';
export async function httpFixture(reader: RunArtifactsReader, bytes?: Pick<OutputByteStore, 'read'>) {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  const server = createApiServer({classify: classifyMetadataError});
  configureSchemaCompilers(server, {schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES});
  const session = createLocalSession({externalOrigin: origin}); session.registerRoutes(server);
  const routes = registerRunArtifactRoutes(server, {reader, ...(bytes ? {bytes} : {}), authorize: session.authorize});
  await server.listen({host: '127.0.0.1', port: address.port});
  const paired = await fetch(origin + '/api/v2/auth/pair', {method: 'POST', headers: {origin, 'content-type': 'application/json',
    'x-beetle-pair': '1'}, body: JSON.stringify({bootstrapToken: session.bootstrapToken})});
  if (paired.status !== 200) throw new Error('Synthetic pairing failed');
  const body = await paired.json() as BrowserSession; const cookie = paired.headers.get('set-cookie')!.split(';')[0]!;
  const headers = {origin, cookie, 'x-beetle-csrf': body.csrfToken};
  const request = (path: string, extra: Record<string, string> = {}) => fetch(origin + path, {headers: {...headers, ...extra}});
  return {server, routes, request, origin, headers,
    close: async () => {session.close(); await routes.close(); await server.close();}};
}
