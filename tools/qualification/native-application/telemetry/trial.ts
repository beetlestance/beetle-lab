import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Offer } from '@beetle/contracts';
import { runtimeName } from '../../../../agent/src/backends/docker/index.js';
import type { AgentRuntimeOptions } from '../../../../agent/src/bootstrap/index.js';
import type { Assembly, Trial } from './assembly.js';
import type { Mode } from './config.js';
import { configuration } from './config.js';
import { readers } from './readers.js';
import { inspect, elapsed, removeStopped } from './native-state.js';
import { artifacts } from './artifacts.js';
interface Input {
  assembly: Assembly;
  options: AgentRuntimeOptions;
  mode: Mode;
  index: number;
  mark: (value: unknown) => Promise<void>;
}
async function executeTrial(
  input: Input,
  trial: Trial,
  offer: Offer,
  key: { organizationId: string; workspaceId: string; attemptId: string; generation: 1 },
  subscribers: ReturnType<typeof readers>,
) {
  const { assembly, options, mode, index, mark } = input;
  const engine = trial.engine;
  const attemptId = key.attemptId;
  const name = runtimeName({ ...key, installationId: options.installation.installationId });
  let started: Awaited<ReturnType<typeof inspect>> = null;
  const accepted = await trial.manager.enqueue(offer);
  assert(accepted.accepted);
  const deadline = performance.now() + 60000;
  for (let count = 0; count < 1200 && performance.now() < deadline; count++) {
    const progress = await trial.manager.drive(key, { deadline: Math.min(deadline, performance.now() + 10000) });
    if (!started) {
      const state = await inspect(options.transport, name);
      if (state?.running) {
        started = state;
        await mark({ phase: 'active', index, mode, runtimeId: state.id });
      }
    }
    if (progress.kind === 'released') {
      assert(started, 'Runtime timing latch missing');
      const source = await assembly.journal.readOutputSource(key);
      assert(source, 'Complete source required');
      const final = await inspect(options.transport, started.id);
      assert(final && !final.running);
      assert.equal(final.exitCode, 0);
      assert.equal(final.startedAt, started.startedAt);
      const wallMs = elapsed(final.startedAt, final.finishedAt);
      const observed = await subscribers.close();
      if (mode === 'on') assert(observed.every((row) => row.frames >= 2));
      else assert(observed.every((row) => row.calls === 0));
      const checked = await artifacts(assembly, key);
      const snapshot = await assembly.journal.get(key);
      assert.equal(snapshot.cancelRequested, false);
      assert.deepEqual(snapshot.admission, { state: 'released', disposition: 'settled' });
      await mark({ phase: 'draining', index, mode });
      await trial.close();
      const removed = await removeStopped(options.transport, {
        id: final.id,
        installationId: options.installation.installationId,
        attemptId,
        generation: 1,
        imageId: engine.manifest.imageDigest,
      });
      return {
        index,
        mode,
        warmup: index < 2,
        wallMs,
        startedAt: final.startedAt,
        finishedAt: final.finishedAt,
        runtimeId: final.id,
        installedIdentity: engine.installedIdentity,
        budget: offer.budget,
        subscribers: observed,
        final: checked,
        removed,
      };
    }
    assert(progress.kind !== 'rejected');
    await delay(50);
  }
  throw Error('Telemetry trial deadline');
}
export async function runTrial(input: Input) {
  const { assembly, mode, index, mark } = input;
  const trial = await assembly.trial(mode);
  const engine = trial.engine;
  const attemptId = randomUUID();
  const offer: Offer = {
    protocolVersion: '1.0',
    organizationId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    attemptId,
    intentDigest: createHash('sha256').update(attemptId).digest('hex'),
    engine: {
      id: engine.manifest.engineId,
      imageDigest: engine.manifest.imageDigest,
      configVersion: engine.configVersion,
    },
    installedIdentity: engine.installedIdentity,
    inputs: [],
    secretReferences: [],
    requiredCapabilities: [],
    config: configuration(),
    budget: { cpuMillis: 1000, memoryBytes: 536870912, pids: 128, timeoutMs: 60000, outputBytes: 8388608 },
    executionPolicy: { mode: 'parallel', preferIdle: false },
  };
  const key = {
    organizationId: offer.organizationId,
    workspaceId: offer.workspaceId,
    attemptId,
    generation: 1 as const,
  };
  const subscribers = readers(trial, key, mode === 'on');
  let result: Awaited<ReturnType<typeof executeTrial>> | undefined;
  let primary: unknown;
  try {
    result = await executeTrial(input, trial, offer, key, subscribers);
  } catch (error) {
    primary = error;
  }
  const closed = await Promise.allSettled([
    mark({ phase: 'draining', index, mode }),
    subscribers.close(),
    trial.close(),
  ]);
  const failures = closed.filter((value) => value.status === 'rejected').map((value) => value.reason as unknown);
  if (primary || failures.length)
    throw new AggregateError([...(primary ? [primary] : []), ...failures], 'Telemetry trial or drain failed', {
      cause: primary,
    });
  assert(result);
  return result;
}
