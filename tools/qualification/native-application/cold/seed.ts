import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { SuiteRevision } from '@beetle/contracts/api';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { Fixture } from '../compose/fixture.js';
import { automaticClient, readContent, hash } from '../compose/public.js';
import { readyContent } from '../compose/content-readiness.js';
import { saveRevision, value, finished } from '../public-api.js';
import { targetCounts, controlBudget, agentState } from '../compose/evidence.js';
export async function seed(f: Fixture, own: (installation: string) => Promise<void>) {
  f.compose('up', '-d', '--no-build');
  const client = await automaticClient(f.origin);
  const installation = client.installation.id;
  await own(installation);
  assert.equal(agentState(f).installationId, installation);
  const reserve = controlBudget(f);
  const config = await seedConfiguration();
  const saved = await saveRevision(client.api, { offer: { config } });
  const queued = value(
    await client.api.createRun({
      params: saved.params,
      body: {
        scope: saved.scope,
        requestId: randomUUID(),
        revisionId: saved.revision.id,
        engineProfile: 'k6-local',
        budget: client.installation.values.runDefaults.budget,
        executionPolicy: { mode: 'parallel', preferIdle: false },
      },
    }),
  );
  const terminal = await finished(client.api, queued, 200);
  const listed = value(
    await client.api.listRunArtifacts({
      params: { ...terminal.params, attemptId: terminal.run.activeAttemptId },
      query: { limit: 100 },
    }),
  );
  assert.equal(listed.availability, 'ready');
  assert.equal(listed.nextCursor, null);
  assert.deepEqual(
    listed.items.map((item) => item.kind).sort(),
    [
      'k6-diagnostics',
      'k6-warnings',
      'metric-index',
      'metric-windows',
      'metrics-csv',
      'native-summary',
      'numeric-final',
      'performance-report',
    ].sort(),
  );
  const artifacts = [];
  for (const item of listed.items) {
    assert(item.bytes <= 4194304);
    const path = runArtifactContentPath({
      ...terminal.params,
      attemptId: terminal.run.activeAttemptId,
      artifactId: item.artifactId,
    });
    const bytes = await readContent(await readyContent((signal) => client.content(path, {}, signal)), 4194304);
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256);
    artifacts.push({ artifactId: item.artifactId, kind: item.kind, bytes: item.bytes, sha256: item.sha256 });
  }
  return { installation, run: terminal.run, reserve, artifacts, requests: targetCounts(f) };
}

async function seedConfiguration() {
  const source = JSON.parse(
    await readFile('contracts/fixtures/api/valid/suite-revision.json', 'utf8'),
  ) as SuiteRevision;
  const config = source.config;
  config.target = 'http://target:8080';
  config.secrets = [];
  config.requests = [
    {
      id: 'get',
      name: 'Cold recovery request',
      method: 'GET',
      path: '/work',
      query: {},
      headers: {},
      assertions: [{ id: 'required', required: true, kind: 'statusEq', value: 200 }],
    },
  ];
  config.readiness = {
    path: '/ready',
    attempts: 1,
    intervalMs: 0,
    timeoutMs: 1000,
    wallBudgetMs: 1000,
    expectedStatus: 200,
    assertions: [],
  };
  assert(createK6ConfigSchema((value) => createHash('sha256').update(value).digest('hex')).validate(config));

  return config;
}
