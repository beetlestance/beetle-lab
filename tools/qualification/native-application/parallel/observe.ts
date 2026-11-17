import assert from 'node:assert/strict';
import type { Run } from '@beetle/contracts/api';
import type { Fixture } from '../compose/fixture.js';
import type { automaticClient } from '../compose/public.js';
import { value, pause } from '../public-api.js';
import { params, runtime } from '../../resources/lifecycle/observations.js';
import { joinReads } from './reads.js';
import type { target } from '../parity/target.js';
export type Client = Awaited<ReturnType<typeof automaticClient>>;
export type Counts = Awaited<ReturnType<typeof target>>;
export function originals(f: Fixture, installation: string) {
  const ids = f.docker
    .run([
      'ps',
      '-q',
      '--no-trunc',
      '--filter',
      `label=dev.beetle.installation=${installation}`,
      '--filter',
      'label=dev.beetle.attempt',
    ])
    .split('\n')
    .filter(Boolean);
  assert(ids.length <= 2 && ids.every((id) => /^[a-f0-9]{64}$/.test(id)), 'Never exceed declared two-engine pool');
  return ids;
}
export async function activePair(options: {
  f: Fixture;
  client: Client;
  runs: readonly Run[];
  counts: Counts;
  installation: string;
}) {
  const { f, client, runs, counts, installation } = options;
  const deadline = performance.now() + 30000;
  for (let n = 0; n < 80 && performance.now() < deadline; n++) {
    const observed = await joinReads(runs.map((run) => client.api.getRun({ params: params(run) }).then(value)));
    for (const [index, run] of observed.entries()) {
      assert.equal(run.activeAttemptId, runs[index]!.activeAttemptId);
      assert(!['finished', 'errored', 'cancelled'].includes(run.state));
    }
    const physical = await counts();
    assert.equal(physical.unexpected, 0);
    originals(f, installation);
    if (
      observed.every((run) => run.state === 'active') &&
      physical.work.shared!.count >= 8 &&
      (runs.length === 1 || physical.work.pervu!.count >= 8)
    ) {
      const ids = observed.map((run) => {
        const engine = runtime(f, run, installation);
        assert.equal(engine.state.Running, true);
        return engine.id;
      });
      assert.equal(new Set(ids).size, runs.length);
      return { ids, physical };
    }
    await pause();
  }
  throw Error('Real simultaneous active originals not observed');
}
export async function queuedOnly(options: {
  f: Fixture;
  client: Client;
  queued: Run;
  counts: Counts;
  installation: string;
  activeIds: readonly string[];
  route: 'arrival' | 'pervu';
}) {
  const { f, client, queued, counts, installation, activeIds, route } = options;
  for (let n = 0; n < 4; n++) {
    const run = value(await client.api.getRun({ params: params(queued) }));
    assert.equal(run.state, 'queued');
    assert.equal(run.activeAttemptId, queued.activeAttemptId);
    const ids = originals(f, installation);
    assert.deepEqual(ids.sort(), [...activeIds].sort());
    const physical = await counts();
    assert.equal(physical.work[route]!.count, 0);
    assert.equal(physical.unexpected, 0);
    await pause();
  }
  return { queuedWithoutOriginal: true };
}
