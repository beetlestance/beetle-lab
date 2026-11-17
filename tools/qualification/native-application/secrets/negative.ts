import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { automaticClient } from '../compose/public.js';
import type { Fixture } from '../compose/fixture.js';
import { value, pause } from '../public-api.js';
import { params } from '../../resources/lifecycle/observations.js';
import { configuration } from './config.js';
import { noCanary } from './audit.js';
export async function wrongWorkspace(
  client: Awaited<ReturnType<typeof automaticClient>>,
  f: Fixture,
  organizationId: string,
  canaries: readonly string[],
) {
  const workspace = value(
    await client.api.createWorkspace({
      params: { organizationId },
      body: { scope: { kind: 'organization', organizationId }, requestId: randomUUID(), name: 'Unbound workspace' },
    }),
  );
  const scope = { kind: 'workspace' as const, organizationId, workspaceId: workspace.id };
  const at = { organizationId, workspaceId: workspace.id };
  const suite = value(
    await client.api.createSuite({
      params: at,
      body: { scope, requestId: randomUUID(), name: 'Same reference wrong authority' },
    }),
  );
  const revision = value(
    await client.api.createSuiteRevision({
      params: { ...at, suiteId: suite.id },
      body: {
        scope,
        requestId: randomUUID(),
        expectedVersion: suite.version,
        engineId: 'k6',
        configVersion: 1,
        config: configuration(),
      },
    }),
  );
  const queued = value(
    await client.api.createRun({
      params: at,
      body: {
        scope,
        requestId: randomUUID(),
        revisionId: revision.id,
        engineProfile: 'k6-local',
        budget: { ...client.installation.values.runDefaults.budget, outputBytes: 33554432 },
        executionPolicy: { mode: 'parallel', preferIdle: false },
      },
    }),
  );
  const deadline = performance.now() + 60000;
  for (let calls = 0; calls < 180 && performance.now() < deadline; calls++) {
    const run = value(await client.api.getRun({ params: params(queued) }));
    assert.equal(run.activeAttemptId, queued.activeAttemptId);
    if (['finished', 'errored', 'cancelled'].includes(run.state)) {
      assert.equal(run.state, 'errored');
      assert.equal(run.reason, 'setup_failed');
      noCanary(JSON.stringify(run), canaries);
      const originals = f.docker.run([
        'ps',
        '-aq',
        '--no-trunc',
        '--filter',
        `label=dev.beetle.installation=${client.installation.id}`,
        '--filter',
        `label=dev.beetle.attempt=${run.activeAttemptId}`,
      ]);
      assert.equal(originals, '');
      return { run, params: at, scope, revision, managedEngineCreated: false };
    }
    await pause();
  }
  throw Error('Unbound workspace did not settle within its declared budget');
}
