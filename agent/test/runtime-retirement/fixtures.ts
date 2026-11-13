import { afterEach } from 'vitest';
import { RuntimeRetirement } from '../../src/runtime-retirement/index.js';
import { ProducerRetirement } from '../../src/producer-retirement/index.js';
import { DockerBackend } from '../../src/backends/docker/index.js';
import { recoverRuntimePlan } from '../../src/installation/index.js';
import { fixture as installationFixture, scope } from '../installation/fixtures.js';
import { requestFor } from '../producer-retirement/fixtures.js';
import { RetiredDocker } from '../backends/docker/retired-fixtures.js';
import { payload } from '../backends/docker/fixtures.js';
export function fixture() {
  const f = installationFixture(); const producers: ProducerRetirement[] = []; const runtimes: RuntimeRetirement[] = [];
  afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map(owner => owner.close()));
    await Promise.allSettled(producers.splice(0).map(owner => owner.close()));
  });
  return { ...f, async ready() {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager); await e.finish(manager); const key = scope(e.offer);
    const proof = await e.owner.readOutputAbsence(key); if (!proof) throw new Error('Missing closure');
    await e.owner.acknowledge({ protocolVersion: '1.0', ...key, throughSeq: proof.finalAgentSeq });
    const coordinator = new ProducerRetirement({ journal: e.owner.retirements, gate: e.options.gate, installation: manager }); producers.push(coordinator);
    const work = coordinator.retire(requestFor(proof)); const result = await work.result; await work.settled;
    if (!result.ok) throw new Error('Missing genuine producer barrier');
    const reservation = await e.owner.admission({ kind: 'reservation', key }); if (!('status' in reservation)) throw new Error('Missing original');
    const plan = recoverRuntimePlan(e.catalog, e.offer, reservation); const docker = new RetiredDocker(plan);
    docker.daemonId = e.configuration.expectedDaemonId; docker.state = payload(plan, 'exited');
    const runtime = new RuntimeRetirement({ journal: e.owner, root: e.staging.root, catalog: e.catalog, transport: docker,
      backend: () => new DockerBackend(docker) }); runtimes.push(runtime);
    return { ...e, manager, coordinator, producer: result.value, key, plan, docker, runtime };
  } };
}
