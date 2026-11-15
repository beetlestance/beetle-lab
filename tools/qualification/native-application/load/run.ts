/** Short packaged idle/load observation; not the30-minute soak. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {UnixDockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {automaticClient, automaticSession} from '../compose/public.js';
import {cleanup, controlBudget} from '../compose/evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {saveRevision, value, finished} from '../public-api.js';
import {configuration} from '../../resources/lifecycle/configuration.js';
import {counts} from '../../resources/lifecycle/observations.js';
import {idle, loaded} from './observe.js';
import {observeNetwork} from './network.js';
import {candidate} from './candidate.js';
const [bundlePath, output, context = 'default', extra] = process.argv.slice(2);
assert(bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra);
const {f, roles, images, identities} = await candidate(bundlePath, context);
await mkdir(output, {mode: 0o700});
await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, owner: randomUUID()}), {flag: 'wx', mode: 0o600});
let installation: string | undefined; let status = 'failed'; let phase = 'startup';
const results: Record<string, unknown> = {};
try {
  f.compose('up', '-d', '--no-build'); const client = await automaticClient(f.origin); installation = client.installation.id;
  await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: installation}), {flag: 'wx', mode: 0o600});
  results.controlReserve = controlBudget(f);
  const peers = ['frontend', 'backend', 'agent'].map(role => {
    const id = f.compose('ps', '-q', role); assert(/^[a-f0-9]{64}$/.test(id));
    const row = f.docker.json<{HostConfig: {Memory: number}; State: {Running: boolean}}[]>(['inspect', id])[0]!;
    assert(row.State.Running); return {role, id, memory: row.HostConfig.Memory};
  });
  const endpoint = f.docker.run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']); assert(endpoint.startsWith('unix://'));
  const transport = new UnixDockerTransport(endpoint.slice(7));
  await observeNetwork(f.origin, async () => {
  phase = 'idle'; const baseline = await idle(peers, transport, client.api, part => {results.idlePartial = part;}); results.idle = baseline;
  const subscribers = await Promise.all([0, 1, 2].map(() => automaticSession(f.origin)));
  const saved = await saveRevision(client.api, {offer: {config: await configuration()}});
  const queued = value(await client.api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(),
    revisionId: saved.revision.id, engineProfile: 'k6-local', budget: client.installation.values.runDefaults.budget,
    executionPolicy: {mode: 'parallel', preferIdle: false}}}));
  phase = 'loaded'; const observed = await loaded(peers, transport, {api: client.api, subscribers: subscribers.map(item => item.api), queued, checkpoint: part => {results.loadedPartial = part;}}); results.loaded = observed;
  await finished(client.api, observed.run, 200);
  const target = counts(f); assert.deepEqual(target, {ready: 1, work: 40, unexpected: 0}); results.targetRequests = target;
  phase = 'post-idle'; const after = await idle(peers, transport, client.api, part => {results.postIdlePartial = part;}); results.postIdle = after;
  const p95TargetMet = [baseline, observed, after].every(window => window.apiP95Ms <= 250 && window.readFailures === 0 && window.endpoints.every(endpoint => endpoint.p95Ms <= 250)); results.p95TargetMet = p95TargetMet;
  status = p95TargetMet ? 'passed' : 'target-missed'; if (!p95TargetMet) process.exitCode = 1;
  }, calls => {results.networkHeaders = calls;});
} catch (error) {
  process.exitCode = 1; await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});
} finally {
  let cleanupVerified = false;
  try {await cleanup(f, installation); if (installation) cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker}); cleanupVerified = true;}
  catch {status = 'failed'; process.exitCode = 1;}
  await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, sourceRevision: f.revision,
    architecture: f.architecture, harnessNode: process.version, environment: f.environment, imageIds: f.imageIds, archiveIdentities: identities, imageSizes: roles.map((role, index) => ({role, bytes: images[index]!.Size})), results}, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({status, phase, cleanupVerified}));
}
