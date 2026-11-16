import { randomUUID } from 'node:crypto';
import { chmod, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas } from '@beetle/contracts/api';
import type { BrowserSession } from '@beetle/contracts/api';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../../src/adapters/inbound/http/schema-compilers.js';
import { createLocalSession } from '../../../src/adapters/inbound/http/session/index.js';
import { registerInputRoutes } from '../../../src/adapters/inbound/http/inputs/index.js';
import { createInputService } from '../../../src/application/inputs/index.js';
import { openLocalInputBytes } from '../../../src/adapters/outbound/files/inputs/index.js';
import { classifyMetadataError } from '../../../src/bootstrap/metadata-errors.js';
import type { InputService } from '../../../src/ports/input-service.js';
import type { InputRecord, InputStore } from '../../../src/ports/inputs.js';
import type { storageFixture } from '../../storage/fixture.js';
import { digest, scope, seed, requestId, uuid } from '../../storage/fixture.js';
import { inputOptions } from '../../storage/inputs-fixture.js';
export { digest, scope, requestId, uuid };
export const host = '127.0.0.1:43127';
export const origin = `http://${host}`;
export const base = `/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/inputs`;
export function deferred<T = void>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const turn = () => new Promise<void>(resolve => setImmediate(resolve));
export function wrap(service: InputService, changes: Partial<InputService>): InputService {
  return { control: service.control.bind(service), append: service.append.bind(service), read: service.read.bind(service),
    get: service.get.bind(service), list: service.list.bind(service), recover: service.recover.bind(service),
    close: service.close.bind(service), ...changes };
}
let sequence = 0;
export async function setup(fixture: ReturnType<typeof storageFixture>,
  transform: (service: InputService) => InputService = service => service,
  overrides: Partial<InputStore> | ((store: InputStore) => Partial<InputStore>) = {}) {
  const metadata = await fixture.open(undefined, inputOptions()); await seed(metadata);
  const directory = join(fixture.root(), `http-inputs-${++sequence}`);
  await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
  const root = await realpath(directory);
  const stagingRoot = join(root, 'staging'); const publishedRoot = join(root, 'published');
  await mkdir(stagingRoot, { mode: 0o700 }); await mkdir(publishedRoot, { mode: 0o700 });
  const bytes = await openLocalInputBytes({ stagingRoot, publishedRoot });
  const changes = typeof overrides === 'function' ? overrides(metadata.inputs) : overrides;
  const service = createInputService({ store: { ...metadata.inputs, ...changes }, bytes, digest });
  const inputs = transform(service);
  const server = createApiServer({ classify: classifyMetadataError });
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  const session = createLocalSession({ externalOrigin: origin }); session.registerRoutes(server);
  const http = registerInputRoutes(server, { inputs, authorize: session.authorize, newId: randomUUID });
  const pair = await server.inject({ method: 'POST', url: '/api/v2/auth/pair', headers: { host, origin, 'x-beetle-pair': '1' },
    payload: { bootstrapToken: session.bootstrapToken } });
  if (pair.statusCode !== 200) throw new Error('Synthetic pairing failed');
  const headers = { host, origin, cookie: String(pair.headers['set-cookie']).split(';')[0]!,
    'x-beetle-csrf': pair.json<BrowserSession>().csrfToken };
  const close = async () => {
    const drainingHttp = http.close(); const drainingService = service.close();
    await Promise.all([drainingHttp, drainingService]); await server.close(); session.close(); await fixture.close(metadata);
  };
  return { server, service, inputs, http, headers, metadata, root, close };
}
export type App = Awaited<ReturnType<typeof setup>>;
export async function create(app: App, content = 'hello π', extra: Record<string, unknown> = {}) {
  const payload = { scope, requestId: requestId(), name: 'Synthetic input', sha256: digest(content),
    bytes: Buffer.byteLength(content), ...extra };
  const response = await app.server.inject({ method: 'POST', url: base, headers: app.headers, payload });
  if (response.statusCode !== 201) throw new Error(`Synthetic creation failed: ${response.body}`);
  return { record: response.json<InputRecord>(), payload };
}
export async function publish(app: App, content = 'hello π') {
  let { record } = await create(app, content);
  if (content) {
    const append = await app.server.inject({ method: 'PUT', url: `${base}/${record.id}/chunks?offset=0`,
      headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from(content) });
    if (append.statusCode !== 200) throw new Error(`Synthetic append failed: ${append.body}`);
    record = append.json<InputRecord>();
  }
  const sealed = await app.server.inject({ method: 'POST', url: `${base}/${record.id}/seal`, headers: app.headers,
    payload: { scope, requestId: requestId(), expectedVersion: record.version } });
  if (sealed.statusCode !== 202) throw new Error(`Synthetic seal failed: ${sealed.body}`);
  return app.service.get({ scope, id: record.id });
}
