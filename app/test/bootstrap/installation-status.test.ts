import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
import { settingsFixture, observation } from '../storage/fixture.js';
const fixture = runFixture();
function funded() {
  const settings = settingsFixture();
  settings.chain.installation.values.pool.storageBytes = 10_000_000;
  settings.runtime.pool.storageBytes = 10_000_000;
  return { installation: settings.chain.installation, runtime: observation(settings.runtime) };
}

it('serves installation status and the scoped run queue through the session-guarded generated client', async () => {
  const opened = await fixture.open(undefined, funded());
  const { api } = await client(opened.app);
  const saved = await savedSuite(api);
  const body = () => ({
    scope: saved.scope,
    requestId: randomUUID(),
    revisionId: saved.pinned.id,
    engineProfile: 'standard',
    budget: settingsFixture().chain.installation.values.runDefaults.budget,
    executionPolicy: { mode: 'parallel' as const, preferIdle: false },
  });
  const first = value(await api.createRun({ params: saved.params, body: body() }));
  const second = value(await api.createRun({ params: saved.params, body: body() }));
  const status = value(await api.getInstallationStatus({}));
  expect(status.agent).toEqual({ state: 'disabled', lastSeenAt: null, checkedAt: null });
  expect(status.host.cpuCores).toEqual({ status: 'unknown', value: null });
  expect(status.engines).toEqual([]);
  expect(status.pool).toMatchObject({ queuedRuns: 2, slots: { used: 0 } });
  const queue = value(await api.getRunQueue({ params: { ...saved.params, runId: second.id } }));
  expect(queue).toMatchObject({ runId: second.id, waiting: 'backend_queue', position: 2, holders: [] });
  expect(value(await api.getRunQueue({ params: { ...saved.params, runId: first.id } })).position).toBe(1);
  const missing = await api.getRunQueue({ params: { ...saved.params, runId: randomUUID() } });
  expect(missing.ok ? 0 : missing.error.status).toBe(404);
  const foreign = await api.getRunQueue({ params: { ...saved.params, workspaceId: randomUUID(), runId: first.id } });
  expect(foreign.ok ? 0 : foreign.error.status).toBe(404);
});

it('refuses the installation read without a paired session', async () => {
  const opened = await fixture.open(undefined, funded());
  const response = await opened.app.server.inject({ method: 'GET', url: '/api/v2/installation/status' });
  expect(response.statusCode).toBe(403);
});
