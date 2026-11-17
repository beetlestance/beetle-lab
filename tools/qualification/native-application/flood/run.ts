import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Run } from '@beetle/contracts/api';
import { UnixDockerTransport } from '../../../../agent/src/backends/docker/index.js';
import { automaticSession, readReadyPublic, readContent, hash } from '../compose/public.js';
import { readyContent } from '../compose/content-readiness.js';
import { cleanup, controlBudget } from '../compose/evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { idle } from '../load/observe.js';
import { observeRss, summarizeRss } from '../rss/observe.js';
import { stopForCustody, ledger } from '../../resources/lifecycle/observations.js';
import { value } from '../public-api.js';
import { configuration } from './config.js';
import { resume } from './resume.js';
import { target } from './target.js';
import { slowTransport } from './slow.js';
import { existingArtifact, refusal } from './proof.js';
import { started, stopped, terminal, events, params, held } from './cases.js';
import { attach } from './attach.js';
const [bundlePath, reference, output, context = 'default', selected = 'all', extra] = process.argv.slice(2);
assert(
  bundlePath && reference && output && isAbsolute(bundlePath) && isAbsolute(reference) && isAbsolute(output) && !extra,
);
assert(['all', 'overflow', 'cancel'].includes(selected));
const config = configuration();
await mkdir(output, { mode: 0o700 });
const override = join(output, 'flood-target.json');
const oracle = await target(override);
const source = await resume(bundlePath, reference, output, context, override);
const { f, installation } = source;
await writeFile(
  join(output, 'owner.json'),
  JSON.stringify({ root: f.root, project: f.project, revision: f.revision, owner: randomUUID() }),
  { flag: 'wx', mode: 0o600 },
);
await writeFile(
  join(output, 'installation-owner.json'),
  JSON.stringify({ project: f.project, installationId: installation }),
  { flag: 'wx', mode: 0o600 },
);
let status = 'failed';
let phase = 'startup';
let window = 'idle';
const results: Record<string, unknown> = {
  baseline: source.before,
  recipeSha256: source.recipeSha256,
  targetSourceSha256: oracle.sourceSha256,
};
let observer: ReturnType<typeof observeRss> | undefined;
let paused: ReturnType<typeof slowTransport> | undefined;
let capture: ReturnType<typeof attach> | undefined;
const runs: Run[] = [];
try {
  f.compose('up', '-d', '--no-deps', '--no-build', 'agent', 'backend', 'frontend', 'synthetic-target');
  const session = await automaticSession(f.origin, undefined, 1024);
  const client = {
    ...session,
    installation: await readReadyPublic((signal) => session.api.getInstallationSettings({ signal })),
  };
  assert.equal(client.installation.id, installation);
  results.controlReserve = controlBudget(f);
  const previous = await existingArtifact(client.api, source.oldRun, source.artifacts);
  results.oldArtifact = { bytes: previous.large.bytes, sha256: previous.large.sha256 };
  paused = slowTransport(f.origin);
  const slowClient = await automaticSession(f.origin, paused.fetch);
  const peers = ['frontend', 'backend', 'agent'].map((role) => {
    const id = f.compose('ps', '-q', role);
    assert(/^[a-f0-9]{64}$/.test(id));
    const row = f.docker.json<{ HostConfig: { Memory: number }; State: { Running: boolean } }[]>(['inspect', id])[0]!;
    assert(row.State.Running);
    return { role, id, memory: row.HostConfig.Memory };
  });
  const endpoint = f.docker.run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
  assert(endpoint.startsWith('unix://'));
  const transport = new UnixDockerTransport(endpoint.slice(7));
  observer = observeRss(context, peers, () => window);
  phase = 'idle';
  results.idle = await idle(peers, transport, client.api, (part) => {
    results.idlePartial = part;
  });
  const owner = source.oldRun.scope;
  const base = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const suite = value(
    await client.api.createSuite({
      params: base,
      body: { scope: owner, requestId: randomUUID(), name: 'Controlled pressure ' + randomUUID() },
    }),
  );
  const revision = value(
    await client.api.createSuiteRevision({
      params: { ...base, suiteId: suite.id },
      body: {
        scope: owner,
        requestId: randomUUID(),
        expectedVersion: suite.version,
        engineId: 'k6',
        configVersion: 1,
        config,
      },
    }),
  );
  const enqueue = async (outputBytes: number) =>
    value(
      await client.api.createRun({
        params: base,
        body: {
          scope: owner,
          requestId: randomUUID(),
          revisionId: revision.id,
          engineProfile: 'k6-local',
          budget: { ...client.installation.values.runDefaults.budget, timeoutMs: 60000, outputBytes },
          executionPolicy: { mode: 'parallel', preferIdle: false },
        },
      }),
    );
  assert.deepEqual(await oracle.counts(), { ready: 0, work: 0, unexpected: 0, perRequest: [0, 0, 0, 0] });
  window = 'loaded';
  if (selected !== 'cancel') {
    phase = 'overflow';
    const overflow = await enqueue(4194304);
    runs.push(overflow);
    const first = await started(client.api, f, overflow, installation, { count: oracle.counts, before: 0 });
    results.overflowStart = first;
    capture = attach(context, first.native.id);
    const firstDone = await terminal(client.api, overflow);
    const firstStop = await stopped(f, first.native.id);
    const captured = await capture.result;
    capture = undefined;
    const firstEvents = await events(client.api, overflow);
    results.overflow = {
      ...firstDone,
      physical: firstStop,
      attached: captured,
      events: firstEvents,
      target: await oracle.counts(),
    };
    assert.equal(firstDone.run.state, 'errored');
    assert.equal(firstDone.run.outcome, 'inconclusive');
    assert.deepEqual(captured.failures, ['output_limit']);
  }
  if (selected !== 'overflow') {
    phase = 'cancel';
    const before = await oracle.counts();
    const cancelled = await enqueue(16777216);
    runs.push(cancelled);
    const second = await started(client.api, f, cancelled, installation, { count: oracle.counts, before: before.work });
    results.cancelStart = second;
    paused.arm(previous.path);
    const response = await slowClient.transport(new URL(previous.path, f.origin), {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    results.slowBefore = held(paused.state());
    results.slowRefusal = await refusal(await client.content(previous.path));
    results.slowAtCancel = held(paused.state());
    const start = performance.now();
    const acknowledgement = value(
      await client.api.cancelRun({ params: params(cancelled), body: { scope: owner, requestId: randomUUID() } }),
    );
    results.cancelAcknowledgementMs = performance.now() - start;
    assert.equal(acknowledgement.cancellationRequested, true);
    results.slowAfterAcknowledgement = held(paused.state());
    results.cancelPhysical = await stopped(f, second.native.id);
    results.cancelPhysicalStopMs = performance.now() - start;
    results.slowAtPhysicalStop = held(paused.state());
    results.slowClose = await paused.close();
    await response.body!.cancel();
    paused = undefined;
    const secondDone = await terminal(client.api, cancelled);
    assert.equal(secondDone.run.state, 'cancelled');
    assert.equal(secondDone.run.outcome, 'inconclusive');
    const cancelEvents = await events(client.api, cancelled);
    assert.equal(cancelEvents.exit.reason, 'cancelled');
    results.cancel = { ...secondDone, events: cancelEvents, target: await oracle.counts() };
    const oldBytes = await readContent(
      await readyContent((signal) => client.content(previous.path, {}, signal)),
      16777216,
      4096,
    );
    assert.equal(oldBytes.length, previous.large.bytes);
    assert.equal(hash(oldBytes), previous.large.sha256);
    results.oldArtifactReverified = true;
  }
  assert.equal(
    f.docker.run([
      'ps',
      '-aq',
      '--filter',
      `label=dev.beetle.installation=${installation}`,
      '--filter',
      `label=dev.beetle.attempt=${source.oldRun.activeAttemptId}`,
    ]),
    '',
  );
  phase = 'post-idle';
  window = 'post-idle';
  results.postIdle = await idle(peers, transport, client.api, (part) => {
    results.postIdlePartial = part;
  });
  const points = await observer.close();
  observer = undefined;
  results.processRss = summarizeRss(points, peers);
  results.rssPoints = points;
  phase = 'custody';
  stopForCustody(f);
  results.originalAllocations = runs.map((run) => ledger(f, run, installation));
  status = 'passed';
} catch (error) {
  process.exitCode = 1;
  await writeFile(
    join(output, 'failure-private.txt'),
    String(error instanceof Error ? error.stack : error).slice(0, 16384),
    { flag: 'wx', mode: 0o600 },
  );
} finally {
  const drains = await Promise.allSettled([paused?.close(), capture?.close(), observer?.close()]);
  if (drains.some((row) => row.status === 'rejected')) {
    status = 'failed';
    process.exitCode = 1;
  }
  results.drains = drains.map((row) => row.status);
  let cleanupVerified = false;
  try {
    await cleanup(f, installation);
    cleanupLiveVolumes({ id: installation, user: '1000:1000', docker: f.docker });
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
        selected,
        cleanupVerified,
        sourceRevision: f.revision,
        architecture: f.architecture,
        harnessNode: process.version,
        imageIds: f.imageIds,
        results,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ status, phase, cleanupVerified }));
}
