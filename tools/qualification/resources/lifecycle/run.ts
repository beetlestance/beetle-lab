/** Finite real-image active crash/cancel qualification; no user install is selected. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Run} from '@beetle/contracts/api';
import {capturePublishedPlan} from '../../../delivery/registry/value.js';
import {readDeliveryJson} from '../../../delivery/files.js';
import {verifyLoadedImage} from '../../../delivery/registry/native-value.js';
import {fixture} from '../../native-application/compose/fixture.js';
import {automaticClient} from '../../native-application/compose/public.js';
import {agentState, controlBudget, cleanup} from '../../native-application/compose/evidence.js';
import {saveRevision, value} from '../../native-application/public-api.js';
import {cleanupLiveVolumes} from '../../native-application/live-volumes.js';
import {active, crash, terminal} from './active.js';
import {counts, ledger, params, runtime, summaries, stopForCustody} from './observations.js';
import {configuration, qualificationCases} from './configuration.js';
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'] as const;
interface PhaseOptions {
  f: Awaited<ReturnType<typeof fixture>>;
  initial: Awaited<ReturnType<typeof automaticClient>>;
  installation: string;
  saved: Awaited<ReturnType<typeof saveRevision>>;
  results: unknown[];
  progress: (phase: string) => void;
  reserve: ReturnType<typeof controlBudget>;
  kinds: ReturnType<typeof qualificationCases>;
}
async function phases({f, initial, installation, saved, results, progress, reserve, kinds}: PhaseOptions) {
  const settled: Run[] = [];
  for (const kind of kinds) {
      progress(kind); const client = await automaticClient(f.origin); assert.equal(client.installation.id, installation);
      const before = counts(f); assert.equal(before.unexpected, 0);
      const queued = value(await client.api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(), revisionId: saved.revision.id,
        engineProfile: 'k6-local', budget: initial.installation.values.runDefaults.budget, executionPolicy: {mode: 'parallel', preferIdle: false}}}));
      const originalId = await active(f, client, queued, before.work);
      let fault: unknown;
      if (kind === 'cancel') {value(await client.api.cancelRun({params: params(queued), body: {scope: saved.scope, requestId: randomUUID()}})); fault = {publicCancel: true};}
      else fault = await crash(f, client, kind, before.work);
      const run = await terminal(client, queued, kind === 'cancel'); const closed = runtime(f, run, installation);
      assert.equal(closed.id, originalId); assert.equal(closed.state.Running, false); assert.equal(closed.state.OOMKilled, false);
      const after = counts(f); assert.equal(after.ready - before.ready, 1); assert.equal(after.unexpected, 0);
      if (kind === 'cancel') assert(after.work - before.work >= 8 && after.work - before.work < 40);
      else assert.equal(after.work - before.work, 40);
      const result = {kind, fault, sameOriginal: true, generation: 1, workRequests: after.work - before.work, runState: run.state,
        outcome: run.outcome, runId: run.id, resourceStatus: 'pending', controlReserve: reserve};
      results.push(result); Object.assign(result, {resourceStatus: 'passed', summaries: await summaries(client.api, run)});
      settled.push(run);
    }
  return settled;
}
async function teardown(f: PhaseOptions['f'], installation?: string) {
  await cleanup(f, installation);
  if (installation) cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker});
}
function custody(f: PhaseOptions['f'], settled: Run[], installation: string, results: unknown[]) {
  stopForCustody(f);
  for (const run of settled) results.push({kind: 'custody', runId: run.id, ...ledger(f, run, installation)});
}
function argumentsFor(argv: string[]) {
  const [publication, output, context = 'default', mode = 'crashes', extra] = argv;
  assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
  return {publication, output, context, mode};
}
async function main() {
  const {publication, output, context, mode} = argumentsFor(process.argv.slice(2));
  const kinds = qualificationCases(mode);
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  const references = roles.map(role => `${plan.repository}@${plan.images.find(image => image.role === role)!.index.digest}`);
  const config = await configuration();
  const f = await fixture([...references, context], 128);
  for (const [index, role] of roles.entries()) {
    const images = f.docker.json<unknown[]>(['image', 'inspect', references[index]!]); assert.equal(images.length, 1);
    verifyLoadedImage(images[0], plan, role, f.architecture as 'amd64' | 'arm64');
  }
  await mkdir(output, {mode: 0o700});
  await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, mode}), {flag: 'wx', mode: 0o600});
  const results: unknown[] = []; let installation: string | undefined; let status = 'failed'; let phase = 'startup'; let cleanupVerified = false;
  try {
    f.compose('up', '-d', '--no-build'); const initial = await automaticClient(f.origin); installation = initial.installation.id;
    assert.equal(agentState(f).installationId, installation); const reserve = controlBudget(f);
    const saved = await saveRevision(initial.api, {offer: {config}});
    const settled = await phases({f, initial, installation, saved, results, progress: next => {phase = next;}, reserve, kinds});
    phase = 'offline-custody'; custody(f, settled, installation, results);
    status = 'passed';
  } catch (error) {
    process.exitCode = 1;
    await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});
  } finally {
    try {await teardown(f, installation); cleanupVerified = true;} catch {status = 'failed'; process.exitCode = 1;}
    await writeFile(join(output, 'outcome.json'), JSON.stringify({format: 'beetle-active-recovery', version: 1, status, mode, phase, cleanupVerified,
      revision: plan.revision, architecture: f.architecture, imageIds: f.imageIds, results,
      limits: ['Active-phase backend/agent crashes only; not every lifecycle phase', 'No synthetic OOM attribution, flood, soak, overhead or cold recovery proof']}, null, 2), {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({status, phase, cleanupVerified}));
  }
}
main().catch(() => {console.error('Packaged active recovery did not qualify'); process.exitCode = 1;});
