import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApiClient, validateApi } from '@beetle/contracts/api';
import type { ApiClient, ApiClientResult, Run } from '@beetle/contracts/api';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import type { MetadataOptions } from '../../src/adapters/outbound/sqlite/index.js';
import { storageFixture, settingsFixture, observation } from '../storage/fixture.js';
import { runOptions } from '../storage/runs-fixture.js';
import revision from '../../../contracts/fixtures/api/valid/create-suite-revision.json' with { type: 'json' };

const defaultOrigin = 'http://127.0.0.1:43179';
export function value<T>(result: ApiClientResult<T>): T {
  if (!result.ok) throw new Error(`Synthetic API failure: ${result.error.kind}/${result.error.status ?? 0}/${result.error.protocol?.code ?? "none"}`);
  return result.value;
}
export function runFixture(storageBytes?: number) {
  const storage = storageFixture(); const applications = new Set<Application>();
  afterEach(async () => { await Promise.all([...applications].map(app => app.close())); applications.clear(); });
  async function open(path = storage.path(), overrides: Partial<MetadataOptions> = {}, native = false) {
    const origin = native ? await ownedOrigin() : defaultOrigin;
    const settings = settingsFixture();
    if (storageBytes !== undefined) {
      settings.chain.installation.values.pool.storageBytes = storageBytes;
      settings.runtime.pool.storageBytes = storageBytes;
    }
    const app = await openApplication({ externalOrigin: origin, metadata: { path, workerUrl: storage.workerUrl(),
      installation: settings.chain.installation, runtime: observation(settings.runtime), ...runOptions(), ...overrides } });
    applications.add(app);
    if (native) await app.server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) });
    return { app, path, origin };
  }
  async function close(app: Application) { await app.close(); applications.delete(app); }
  return { open, close };
}
export async function client(app: Application, loseFirstRun = false, wireOrigin?: string, loseFirstCancellation = false) {
  if (wireOrigin && !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(wireOrigin)) throw new Error('Synthetic listener boundary');
  const origin = wireOrigin ?? defaultOrigin;
  const lostRoute = loseFirstRun ? '/runs' : loseFirstCancellation ? '/cancel' : null;
  let cookie = ''; let requests = 0;
  const observed: { status?: number; run?: Run } = {};
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (++requests > 64 || url.origin !== origin || !url.pathname.startsWith('/api/v2/')) throw new Error('Synthetic request boundary');
    const headers = new Headers(init?.headers); headers.set('host', new URL(origin).host); headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const response = await exchange(app, url, init, headers, wireOrigin);
    const received = response.headers.get('set-cookie');
    if (received) cookie = received.split(';')[0]!;
    if (shouldLose(lostRoute, init?.method, url.pathname, observed.status)) {
      observed.status = response.status;
      const checked = validateApi('Run', await response.json()); if (checked.ok) observed.run = checked.value;
      throw new Error('Synthetic lost enqueue response');
    }
    return response;
  };
  const unpaired = createApiClient({ baseUrl: origin, fetch: fetcher, headers: { 'X-Beetle-Pair': '1' } });
  const session = value(await unpaired.pairBrowserSession({ body: { bootstrapToken: app.bootstrapToken } }));
  return { api: createApiClient({ baseUrl: origin, fetch: fetcher, headers: { 'X-Beetle-CSRF': session.csrfToken } }), observed };
}
export async function savedSuite(api: ApiClient) {
  const organization = value(await api.createOrganization({ body: { scope: { kind: 'installation' },
    requestId: randomUUID(), name: 'Synthetic run organization', slug: 'synthetic-run' } }));
  const workspace = value(await api.createWorkspace({ params: { organizationId: organization.id }, body: {
    scope: { kind: 'organization', organizationId: organization.id }, requestId: randomUUID(), name: 'Synthetic workspace' } }));
  const params = { organizationId: organization.id, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const suite = value(await api.createSuite({ params, body: { scope, requestId: randomUUID(), name: 'Synthetic suite' } }));
  const body = validateApi('CreateSuiteRevisionRequest', {
    ...structuredClone(revision), scope, requestId: randomUUID(), expectedVersion: suite.version });
  if (!body.ok) throw new Error('Invalid synthetic revision');
  const pinned = value(await api.createSuiteRevision({ params: { ...params, suiteId: suite.id }, body: body.value }));
  return { params, scope, pinned };
}

async function exchange(app: Application, url: URL, init: RequestInit | undefined, headers: Headers, wireOrigin?: string): Promise<Response> {
  if (wireOrigin) return fetch(url, { ...init, headers, redirect: 'error' });
  const response = await app.server.inject({ method: init?.method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: url.pathname + url.search, headers: Object.fromEntries(headers),
    ...(typeof init?.body === 'string' ? { payload: init.body } : {}) });
  const outgoing = new Headers({ 'content-type': 'application/json' });
  if (response.headers['set-cookie']) outgoing.set('set-cookie', String(response.headers['set-cookie']));
  return new Response(response.body, { status: response.statusCode, headers: outgoing });
}

function shouldLose(route: string | null, method: string | undefined, path: string, status: number | undefined): boolean {
  return route !== null && method === 'POST' && path.endsWith(route) && status === undefined;
}

async function ownedOrigin(): Promise<string> {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address();
  try {
    if (!address || typeof address === 'string') throw new Error('Synthetic listener unavailable');
    return `http://127.0.0.1:${address.port}`;
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
}
