import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
import { settingsFixture, observation } from '../storage/fixture.js';
const fixture = runFixture();
it('serves folder-first suite listing, folder summaries and revision Run counts over authenticated HTTP', async () => {
  const settings = settingsFixture();
  settings.chain.installation.values.pool.storageBytes = 1_000_000;
  settings.runtime.pool.storageBytes = 1_000_000;
  const opened = await fixture.open(
    undefined,
    { installation: settings.chain.installation, runtime: observation(settings.runtime) },
    true,
  );
  const { api } = await client(opened.app, false, opened.origin);
  const saved = await savedSuite(api);
  const peer = value(
    await api.createSuite({ params: saved.params, body: { scope: saved.scope, requestId: randomUUID(), name: 'Peer' } }),
  );
  const run = value(
    await api.createRun({
      params: saved.params,
      body: {
        scope: saved.scope,
        requestId: randomUUID(),
        revisionId: saved.pinned.id,
        engineProfile: 'standard',
        budget: settings.chain.installation.values.runDefaults.budget,
        executionPolicy: { mode: 'parallel', preferIdle: false },
      },
    }),
  );
  const first = value(await api.listSuites({ params: saved.params, query: { limit: 1 } }));
  expect(first.items.map((item) => item.id)).toEqual([saved.pinned.suiteId]);
  expect(first.summaries).toEqual([
    {
      suiteId: saved.pinned.suiteId,
      engineId: 'k6',
      group: 'in_progress',
      latestRun: { suiteId: run.suiteId, runId: run.id, state: run.state, outcome: run.outcome, requestedAt: run.requestedAt },
    },
  ]);
  const next = value(await api.listSuites({ params: saved.params, query: { limit: 1, cursor: first.nextCursor! } }));
  expect(next.items.map((item) => item.id)).toEqual([peer.id]);
  expect(next.summaries).toEqual([{ suiteId: peer.id, engineId: null, group: 'no_runs', latestRun: null }]);
  const filtered = { limit: 10, group: 'no_runs', order: 'name', name: 'peer', folderId: peer.folderId } as const;
  expect(value(await api.listSuites({ params: saved.params, query: filtered })).items).toEqual([peer]);
  expect(value(await api.listSuites({ params: saved.params, query: { limit: 10, engineId: 'k6' } })).items).toHaveLength(1);
  const rebound = await api.listSuites({ params: saved.params, query: { limit: 1, group: 'passed', cursor: first.nextCursor! } });
  expect(rebound.ok).toBe(false);
  const folders = value(await api.listFolders({ params: saved.params, query: { limit: 10 } }));
  expect(folders.summaries).toEqual([
    {
      folderId: peer.folderId,
      suiteCount: 2,
      subfolderCount: 0,
      groups: { in_progress: 1, passed: 0, failed: 0, inconclusive: 0, stopped: 0, no_runs: 1 },
      latestRun: first.summaries![0]!.latestRun,
    },
  ]);
  const revision = value(
    await api.getSuiteRevision({ params: { ...saved.params, revisionId: saved.pinned.id } }),
  );
  expect(revision.runCount).toBe(1);
  await fixture.close(opened.app);
});
