import assert from 'node:assert/strict';
import type {Run} from '@beetle/contracts/api';
import type {Fixture} from '../../native-application/compose/fixture.js';
import {readReadyPublic} from '../../native-application/compose/public.js';
import {pause, value} from '../../native-application/public-api.js';
import {record, counter} from '../values.js';
import {recoveredAgent} from './readiness.js';
import {counts, params, runtime} from './observations.js';
import type {automaticClient} from '../../native-application/compose/public.js';
export type Client = Awaited<ReturnType<typeof automaticClient>>;
export async function active(f: Fixture, client: Client, queued: Run, before: number) {
  const deadline = performance.now() + 30000;
  for (let n = 0; n < 80 && performance.now() < deadline; n++) {
    const run = value(await client.api.getRun({params: params(queued)})); assert.equal(run.activeAttemptId, queued.activeAttemptId);
    assert(!['finished', 'errored', 'cancelled'].includes(run.state), 'Crash requires actual active original');
    if (run.state === 'active' && counts(f).work >= before + 8) {
      const original = runtime(f, run, client.installation.id); assert.equal(original.state.Running, true);
      return original.id;
    }
    await pause();
  }
  throw Error('Active original not observed within budget');
}
function service(f: Fixture, kind: 'agent' | 'backend') {
  const id = f.compose('ps', '-q', kind); assert.match(id, /^[a-f0-9]{64}$/);
  const rows = f.docker.json<unknown[]>(['inspect', id]); assert.equal(rows.length, 1); const row = record(rows[0]);
  const labels = record(record(row.Config).Labels); assert.equal(labels['com.docker.compose.project'], f.project);
  assert.equal(labels['com.docker.compose.service'], kind); assert.equal(row.Image, f.imageIds[kind]);
  assert.equal(record(row.State).Running, true);
  return {id, restartCount: counter(row.RestartCount), startedAt: record(row.State).StartedAt};
}
export async function crash(f: Fixture, client: Client, kind: 'agent' | 'backend', workBefore: number) {
  const recoveryStarted = performance.now(); const before = service(f, kind); f.docker.run(['kill', '--signal', 'KILL', before.id]);
  const progressAtAcknowledgedKill = counts(f).work - workBefore;
  assert(progressAtAcknowledgedKill >= 8 && progressAtAcknowledgedKill < 40, 'Work completed before acknowledged crash');
  const killedRows = f.docker.json<unknown[]>(['inspect', before.id]); assert.equal(killedRows.length, 1);
  const killed = record(killedRows[0]); const killedState = record(killed.State);
  let restart = 'automatic';
  if (killedState.Running !== true) {
    assert.equal(killedState.Running, false); assert.equal(killedState.ExitCode, 137); assert.equal(killedState.OOMKilled, false);
    f.docker.run(['start', before.id]); restart = 'explicit-same-service';
  }
  const deadline = performance.now() + 45000; let lastReadinessStatus: number | null = null;
  for (let n = 0; n < 100 && performance.now() < deadline; n++) {
    const rows = f.docker.json<unknown[]>(['inspect', before.id]); const row = record(rows[0]); const state = record(row.State);
    if (state.Running === true && state.StartedAt !== before.startedAt) {
      const ready = kind === 'backend' ? {ready: true, status: 200} : recoveredAgent(f, client.installation.id);
      lastReadinessStatus = ready.status;
      if (!ready.ready) {await pause(); continue;}
      assert.deepEqual(await readReadyPublic(signal => client.api.getBrowserSession({signal})), client.session);
      const workAtReadiness = counts(f).work - workBefore; assert(workAtReadiness >= progressAtAcknowledgedKill && workAtReadiness < 40, `Original finished or reset before recovered service was ready (HTTP ${lastReadinessStatus}, ${Math.ceil(performance.now() - recoveryStarted)}ms)`);
      return {signal: 'SIGKILL', restart, recoveryElapsedMs: Math.ceil(performance.now() - recoveryStarted), workAtReadiness, progressAtAcknowledgedKill, restartCountBefore: before.restartCount, restartCountAfter: counter(row.RestartCount), sameServiceContainer: true};
    }
    await pause();
  }
  throw Error(`Owned service did not recover within budget (HTTP ${lastReadinessStatus})`);
}
export async function terminal(client: Client, queued: Run, cancelled: boolean) {
  const deadline = performance.now() + 60000;
  for (let n = 0; n < 160 && performance.now() < deadline; n++) {
    const run = await readReadyPublic(signal => client.api.getRun({params: params(queued), signal}));
    assert.equal(run.activeAttemptId, queued.activeAttemptId);
    if (['finished', 'cancelled', 'errored'].includes(run.state)) {
      assert.equal(run.state, cancelled ? 'cancelled' : 'finished'); assert.equal(run.outcome, cancelled ? 'inconclusive' : 'passed');
      const result = value(await client.api.getRunResult({params: params(queued)}));
      if (cancelled) assert.equal(result.result, null);
      else {assert(result.result); assert.equal(result.result.outcome, 'passed'); assert.equal(result.result.execution.exitCode, 0);}
      return run;
    }
    await pause();
  }
  throw Error('Original did not settle within budget');
}
