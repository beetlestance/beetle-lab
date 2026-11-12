import type {Offer} from '@beetle/contracts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createApiClient } from '@beetle/contracts/api';
import type { ApiClient, ApiClientResult, Run } from '@beetle/contracts/api';
import type { Application } from '../../../app/src/bootstrap/api.js';
import type { Fixture } from '../../../agent/test/container/fixture.js';

export const pause = () => new Promise(resolve => setTimeout(resolve, 250));
export function value<T>(result: ApiClientResult<T>): T {
  if (!result.ok) throw new Error(`Public API failure: ${result.error.kind}/${result.error.status ?? 0}/${result.error.protocol?.code ?? 'none'}`);
  return result.value;
}
export async function ownedOrigin(): Promise<string> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  try {
    assert(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
/** Real TCP, bounded generated transport, explicit cookie/CSRF session, no mutation retries. */
export async function publicClient(app: Application, origin: string) {
  let cookie = ''; let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert(++requests <= 256 && url.origin === origin && url.pathname.startsWith('/api/v2/'), 'Public request boundary');
    const headers = new Headers(init?.headers); headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(url, { ...init, headers, redirect: 'error' });
    const received = response.headers.get('set-cookie');
    if (received) { assert(received.length <= 4096); cookie = received.split(';')[0]!; }
    return response;
  };
  const options = { baseUrl: origin, fetch: fetcher, maximumBytes: 1_048_576, timeoutMs: 3000 };
  const unpaired = createApiClient({ ...options, headers: { 'X-Beetle-Pair': '1' } });
  const session = value(await unpaired.pairBrowserSession({ body: { bootstrapToken: app.bootstrapToken } }));
  const api = createApiClient({ ...options, headers: { 'X-Beetle-CSRF': session.csrfToken } });
  assert.deepEqual(value(await api.getBrowserSession()), session);
  return { api, requestCount: () => requests, content:(path:string,headers:Record<string,string>={})=>
    fetcher(new URL(path,origin),{headers,signal:AbortSignal.timeout(5000)}) };
}
export async function saveRevision(api: ApiClient, f: {readonly offer:{readonly config:Offer['config']}}) {
  const organization = value(await api.createOrganization({ body: { scope: { kind: 'installation' },
    requestId: randomUUID(), name: 'Synthetic native qualification', slug: 'native-qualification' } }));
  const workspace = value(await api.createWorkspace({ params: { organizationId: organization.id }, body: {
    scope: { kind: 'organization', organizationId: organization.id }, requestId: randomUUID(), name: 'Synthetic workload' } }));
  const params = { organizationId: organization.id, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const suite = value(await api.createSuite({ params, body: { scope, requestId: randomUUID(), name: 'One native request' } }));
  const revision = value(await api.createSuiteRevision({ params: { ...params, suiteId: suite.id }, body: {
    scope, requestId: randomUUID(), expectedVersion: suite.version, engineId: 'k6', configVersion: 1, config: f.offer.config } }));
  assert.deepEqual(value(await api.getSuiteRevision({ params: { ...params, revisionId: revision.id } })), revision);
  return {params,scope,revision};
}
export async function enqueue(api:ApiClient,f:Fixture):Promise<Run>{
  const {params,scope,revision}=await saveRevision(api,f);
  return value(await api.createRun({ params, body: { scope, requestId: randomUUID(), revisionId: revision.id,
    engineProfile: 'native-k6', budget: f.budget, executionPolicy: { mode: 'parallel', preferIdle: false } } }));
}
export async function waitForCapacity(app: Application): Promise<void> {
  for (let calls = 0; calls < 100; calls++) {
    const state = app.runtimeState();
    if (state !== 'disabled' && state.status === 'published') return;
    await pause();
  }
  throw new Error('Actual backend/agent capacity did not become available');
}
export async function finished(api: ApiClient, queued: Run, status: number) {
  const params = { organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, runId: queued.id };
  const deadline = Date.now() + 60_000;
  for (let calls = 0; calls < 180 && Date.now() < deadline; calls++) {
    const run = value(await api.getRun({ params }));
    if (['finished', 'cancelled', 'errored'].includes(run.state)) {
      assert.equal(run.state, 'finished'); assert.equal(run.outcome, status === 200 ? 'passed' : 'failed');
      assert.equal(run.validationStatus, 'passed'); assert.equal(run.reason, null);
      const result = value(await api.getRunResult({ params })); assert(result.result);
      assert.equal(result.result.outcome, run.outcome); assert.equal(result.result.execution.exitCode, status === 200 ? 0 : 99);
      assert.equal(result.activeAttemptId, run.activeAttemptId);
      const other = { ...params, workspaceId: randomUUID() };
      for (const denied of [await api.getRun({ params: other }), await api.getRunResult({ params: other })]) {
        assert(!denied.ok && denied.error.status === 404, 'Wrong workspace must not expose the run/result');
      }
      return { run, result, params };
    }
    await pause();
  }
  throw new Error('Public run did not reach verified terminal settlement');
}
