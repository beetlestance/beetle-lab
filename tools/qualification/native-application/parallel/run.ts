import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidate } from '../load/candidate.js';
import { automaticSession, readReadyPublic } from '../compose/public.js';
import { cleanup, controlBudget } from '../compose/evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { value, finished } from '../public-api.js';
import { runtime, params } from '../../resources/lifecycle/observations.js';
import { terminal } from '../../resources/lifecycle/active.js';
import { target } from '../parity/target.js';
import { author } from './author.js';
import { joinReads } from './reads.js';
import { activePair, queuedOnly, originals } from './observe.js';
const [bundlePath, output, context = 'default', profile = 'shared', extra] = process.argv.slice(2);
assert(
  bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra && /^v24\./.test(process.version),
);
assert(profile === 'shared' || profile === 'isolated');
const { f } = await candidate(bundlePath, context, 512);
await mkdir(output, { mode: 0o700 });
await writeFile(
  join(output, 'owner.json'),
  JSON.stringify({ root: f.root, project: f.project, revision: f.revision, owner: randomUUID() }),
  { flag: 'wx', mode: 0o600 },
);
let installation: string | undefined;
let requestCount: (() => number) | undefined;
let status = 'failed';
let phase = 'startup';
const results: Record<string, unknown> = {};
try {
  const counts = await target(f);
  f.compose('up', '-d', '--no-build');
  const session = await automaticSession(f.origin, undefined, 1024);
  requestCount = session.requests;
  const client = {
    ...session,
    installation: await readReadyPublic((signal) => session.api.getInstallationSettings({ signal })),
  };
  installation = client.installation.id;
  await writeFile(
    join(output, 'installation-owner.json'),
    JSON.stringify({ project: f.project, installationId: installation }),
    { flag: 'wx', mode: 0o600 },
  );
  results.controlReserve = controlBudget(f);
  const pool = client.installation.values.pool;
  assert.equal(pool.concurrency, 2);
  assert.equal(pool.cpuMillis, 2000);
  assert.equal(pool.memoryBytes, 1073741824);
  assert.equal(pool.pids, 256);
  results.pool = pool;
  const a = await author(client.api, 'shared');
  const b = await author(client.api, 'pervu');
  assert.notEqual(a.scope.organizationId, b.scope.organizationId);
  const create = async (saved: typeof a, mode: 'parallel' | 'isolated') =>
    value(
      await client.api.createRun({
        params: saved.params,
        body: {
          scope: saved.scope,
          requestId: randomUUID(),
          revisionId: saved.revision.id,
          engineProfile: 'k6-local',
          budget: client.installation.values.runDefaults.budget,
          executionPolicy: { mode, preferIdle: false },
        },
      }),
    );
  const overflow = profile === 'shared' ? await author(client.api, 'arrival') : undefined;
  phase = 'start-originals';
  const first = await create(a, profile === 'shared' ? 'parallel' : 'isolated');
  if (profile === 'isolated')
    results.isolatedActive = await activePair({ f, client, runs: [first], counts, installation });
  const second = await create(b, 'parallel');
  if (profile === 'shared') {
    results.simultaneous = await activePair({ f, client, runs: [first, second], counts, installation });
    assert(overflow);
    const queued = await create(overflow, 'parallel');
    phase = 'overflow';
    results.overflow = await queuedOnly({
      f,
      client,
      queued,
      counts,
      installation,
      activeIds: originals(f, installation),
      route: 'arrival',
    });
    value(
      await client.api.cancelRun({ params: params(queued), body: { scope: overflow.scope, requestId: randomUUID() } }),
    );
    results.overflowCancelled = await terminal(client, queued, true);
  } else {
    phase = 'isolated-queue';
    results.isolatedQueue = await queuedOnly({
      f,
      client,
      queued: second,
      counts,
      installation,
      activeIds: originals(f, installation),
      route: 'pervu',
    });
  }
  phase = 'settlement';
  const complete = (key: string, run: typeof first) =>
    finished(client.api, run, 200).then((row) => {
      results[key] = row;
      return row;
    });
  const completed =
    profile === 'shared'
      ? await joinReads([complete('first', first), complete('second', second)])
      : [await complete('first', first), await complete('second', second)];
  results.completed = completed;
  const engines = completed.map((row) => {
    const engine = runtime(f, row.run, installation!);
    assert.equal(engine.state.Running, false);
    assert.equal(engine.state.OOMKilled, false);
    return engine;
  });
  results.engines = engines;
  if (profile === 'isolated') {
    const stopped = engines[0]!.state.FinishedAt;
    const started = engines[1]!.state.StartedAt;
    assert(typeof stopped === 'string' && typeof started === 'string');
    assert(
      Number.isFinite(Date.parse(stopped)) &&
        Number.isFinite(Date.parse(started)) &&
        Date.parse(started) >= Date.parse(stopped),
    );
    results.noExecutionOverlap = true;
  }
  const observed = await counts();
  results.target = observed;
  assert.equal(observed.ready, 2);
  assert.equal(observed.unexpected, 0);
  assert.equal(observed.work.shared!.count, 40);
  assert.equal(observed.work.pervu!.count, 40);
  assert.equal(observed.work.arrival!.count, 0);
  status = 'passed';
} catch (error) {
  process.exitCode = 1;
  await writeFile(
    join(output, 'failure-private.txt'),
    String(error instanceof Error ? error.stack : error).slice(0, 16384),
    { flag: 'wx', mode: 0o600 },
  );
} finally {
  results.clientRequests = requestCount?.() ?? 0;
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
        profile,
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
