import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidate } from '../load/candidate.js';
import { automaticClient } from '../compose/public.js';
import { cleanup, controlBudget } from '../compose/evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { value, finished } from '../public-api.js';
import { record, counter } from '../../resources/values.js';
import { runtime } from '../../resources/lifecycle/observations.js';
import { configuration } from './config.js';
import { inputs } from './inputs.js';
import { target } from './target.js';
const [bundlePath, output, context = 'default', extra] = process.argv.slice(2);
assert(
  bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra && /^v24\./.test(process.version),
);
const { f } = await candidate(bundlePath, context);
await mkdir(output, { mode: 0o700 });
await writeFile(
  join(output, 'owner.json'),
  JSON.stringify({ root: f.root, project: f.project, revision: f.revision, owner: randomUUID() }),
  { flag: 'wx', mode: 0o600 },
);
let installation: string | undefined;
let status = 'failed';
let phase = 'startup';
let observed: Awaited<ReturnType<typeof target>> | undefined;
const results: Record<string, unknown> = {};
try {
  observed = await target(f);
  results.targetSource = { sourceSha256: observed.sourceSha256, compiledSha256: observed.compiledSha256 };
  f.compose('up', '-d', '--no-build');
  const client = await automaticClient(f.origin);
  installation = client.installation.id;
  results.controlReserve = controlBudget(f);
  await writeFile(
    join(output, 'installation-owner.json'),
    JSON.stringify({ project: f.project, installationId: installation }),
    { flag: 'wx', mode: 0o600 },
  );
  const organization = value(
    await client.api.createOrganization({
      body: {
        scope: { kind: 'installation' },
        requestId: randomUUID(),
        name: 'Native requests',
        slug: 'native-requests',
      },
    }),
  );
  const workspace = value(
    await client.api.createWorkspace({
      params: { organizationId: organization.id },
      body: {
        scope: { kind: 'organization', organizationId: organization.id },
        requestId: randomUUID(),
        name: 'Native data',
      },
    }),
  );
  const params = { organizationId: organization.id, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const suite = value(
    await client.api.createSuite({ params, body: { scope, requestId: randomUUID(), name: 'Request semantics' } }),
  );
  phase = 'inputs';
  const refs = await inputs(client, f.origin, scope);
  results.inputs = refs;
  for (const malformed of [false, true]) {
    phase = malformed ? 'malformed-response' : 'methods-data-assertions';
    const suiteParams = { ...params, suiteId: suite.id };
    const current = value(await client.api.getSuite({ params: suiteParams }));
    const revision = value(
      await client.api.createSuiteRevision({
        params: suiteParams,
        body: {
          scope,
          requestId: randomUUID(),
          expectedVersion: current.version,
          engineId: 'k6',
          configVersion: 1,
          config: configuration(refs, malformed),
        },
      }),
    );
    const queued = value(
      await client.api.createRun({
        params,
        body: {
          scope,
          requestId: randomUUID(),
          revisionId: revision.id,
          engineProfile: 'k6-local',
          budget: client.installation.values.runDefaults.budget,
          executionPolicy: { mode: 'parallel', preferIdle: false },
        },
      }),
    );
    results[phase] = { queued };
    const done = await finished(client.api, queued, malformed ? 500 : 200);
    const engine = runtime(f, done.run, installation);
    assert.equal(engine.state.Running, false);
    assert.equal(engine.state.OOMKilled, false);
    results[phase] = { ...done, engine, target: await observed.counts() };
    if (malformed) assert(done.result.result!.requiredAssertions.failed > 0);
    else assert.deepEqual(done.result.result!.requiredAssertions, { required: 50, passed: 50, failed: 0, unknown: 0 });
  }
  const counts = await observed.counts();
  results.finalCounts = counts;
  assert.deepEqual(counts.methods, { GET: 4, POST: 4, PUT: 4, PATCH: 4, DELETE: 4 });
  const seen = record(counts.seen);
  assert.deepEqual((seen.json as string[]).slice().sort(), ['J1', 'J2']);
  assert.deepEqual((seen.numbers as string[]).slice().sort(), ['1', '3', '5']);
  const perVu = record(counts.perVu);
  assert.deepEqual(
    Object.keys(perVu)
      .map(Number)
      .sort((a, b) => a - b),
    Array.from({ length: 10 }, (_, i) => i + 1),
  );
  for (const value of Object.values(perVu)) assert.equal(counter(record(value).count), 2);
  assert.equal(counts.ready, 3);
  assert.equal(counts.malformed, 3);
  assert.equal(counts.rejected, 0);
  assert.equal(counts.total, 26);
  status = 'passed';
} catch (error) {
  process.exitCode = 1;
  await writeFile(
    join(output, 'failure-private.txt'),
    String(error instanceof Error ? error.stack : error).slice(0, 16384),
    { flag: 'wx', mode: 0o600 },
  );
} finally {
  try {
    if (observed) results.targetBeforeTeardown = await observed.counts();
  } catch {
    results.targetBeforeTeardown = 'unavailable';
  }
  let cleanupVerified = false;
  try {
    await cleanup(f, installation);
    if (installation) cleanupLiveVolumes({ id: installation, user: '1000:1000', docker: f.docker });
    cleanupVerified = true;
  } catch {
    status = 'failed';
    process.exitCode = 1;
  }
  await writeFile(
    join(output, 'outcome-private.json'),
    JSON.stringify(
      {
        status,
        phase,
        cleanupVerified,
        revision: f.revision,
        architecture: f.architecture,
        imageIds: f.imageIds,
        harnessNode: process.version,
        results,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ status, phase, cleanupVerified }));
}
