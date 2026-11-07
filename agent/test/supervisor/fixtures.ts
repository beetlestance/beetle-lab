import { performance } from 'node:perf_hooks';
import type { Offer } from '@beetle/contracts';
import type { AdmissionCommand, AdmissionValue } from '../../src/admission/index.js';
import type { Journal } from '../../src/journal/index.js';
import { DockerBackend, prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import type { InspectEvidence, MutationResult, Observation, Operation, RuntimePlan } from '../../src/backends/docker/index.js';
import { Supervisor } from '../../src/supervisor/index.js';
import type { BackendPort, JournalPort } from '../../src/supervisor/index.js';
import { admissionFixture, now, reserved, scope } from '../admission/fixtures.js';
import { FakeDocker, id, makeInput } from '../backends/docker/fixtures.js';

export { id, now, reserved, scope };
export const installationId = '00000000-0000-4000-8000-000000000010';
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export function clock() {
  // Integer fake milliseconds make split advances exact for grace identity checks.
  let wall = now; let mono = Math.ceil(performance.now());
  return { wall: () => wall, monotonic: () => mono,
    advance(ms: number) { wall += ms; mono += ms; }, wallOnly(value: number) { wall = value; },
    monoOnly(value: number) { mono = value; } };
}
export function supervisorFixture() {
  const f = admissionFixture();
  return { ...f,
    async setup(path?: string, jobId = 1, mutate?: (offer: Offer) => void, quota?: number) {
      const journal = await f.configured(path, quota);
      const offer = f.job(jobId); mutate?.(offer);
      await f.enqueue(journal, offer); await f.admit(journal, offer);
      const input = makeInput(); input.offer = offer;
      input.manifest.minimumBudget = { ...offer.budget };
      // Identity/staging changes with the synthetic offer.
      const base = { ...input, profile: { ...input.profile, maximumBudget: { ...offer.budget } }, staged: { input: '', output: '' } };
      const name = runtimeName({ ...offer, installationId, generation: 1 });
      base.staged = { input: `${input.profile.stagingRoot}/${name}/input`, output: `${input.profile.stagingRoot}/${name}/output` };
      const prepared = prepareRuntime(base);
      if (!prepared.ok) throw new Error(prepared.reason);
      const plan = prepared.value;
      const transport = new FakeDocker(plan);
      const time = clock();
      const manager = new Supervisor({ journal, installationId, clock: time,
        backendFactory: () => new DockerBackend(transport) });
      return { journal, offer, plan, transport, time, manager, input: { key: scope(offer), plan } };
    },
  };
}
export function port(journal: Journal, admission?: (input: AdmissionCommand) => Promise<AdmissionValue>): JournalPort {
  return { admission: admission ?? (input => journal.admission(input)),
    readOffer: key => journal.readOffer(key), supervision: input => journal.supervision(input),
    sourceCursors: key => journal.sourceCursors(key), appendSupervisor: input => journal.appendSupervisor(input) };
}
/** Exact backend signatures, one observed identity, and explicit synthetic effect counters. */
export class ControlledBackend implements BackendPort {
  creates = 0; starts = 0; stops: number[] = []; kills = 0;
  observation: Observation = { state: 'missing' };
  createHold: ReturnType<typeof deferred<MutationResult<InspectEvidence>>> | undefined;
  startHold: ReturnType<typeof deferred<MutationResult<InspectEvidence>>> | undefined;
  stopChangesState = true;
  createResult: MutationResult<InspectEvidence> | undefined;
  startResult: MutationResult<InspectEvidence> | undefined;
  async ensureCreated(_plan: RuntimePlan, _operation: Operation): Promise<MutationResult<InspectEvidence>> {
    void _plan; void _operation; this.creates++;
    const result = this.createHold ? await this.createHold.promise : this.createResult ?? this.known('created');
    if (result.outcome === 'known') this.observation = result.value;
    return result;
  }
  async dispatchStartOnce(_plan: RuntimePlan, _operation: Operation): Promise<MutationResult<InspectEvidence>> {
    void _plan; void _operation; this.starts++;
    const result = this.startHold ? await this.startHold.promise : this.startResult ?? this.known('running');
    if (result.outcome === 'known') this.observation = result.value;
    return result;
  }
  inspect(_plan: RuntimePlan, _operation: Operation): Promise<Observation> {
    void _plan; void _operation; return Promise.resolve(this.observation);
  }
  stop(_plan: RuntimePlan, _operation: Operation, grace: number): Promise<MutationResult<InspectEvidence>> {
    void _plan; void _operation; this.stops.push(grace);
    return Promise.resolve(this.terminate());
  }
  kill(_plan: RuntimePlan, _operation: Operation): Promise<MutationResult<InspectEvidence>> {
    void _plan; void _operation; this.kills++;
    return Promise.resolve(this.terminate(true));
  }
  private terminate(force = false): MutationResult<InspectEvidence> {
    if (!('id' in this.observation)) return { outcome: 'unknown', reason: 'unavailable' };
    if (this.observation.state === 'created' || this.observation.state === 'exited') return { outcome: 'known', value: this.observation };
    if (force || this.stopChangesState) {
      this.observation = this.known('exited').value;
      return { outcome: 'known', value: this.observation };
    }
    return { outcome: 'unknown', reason: 'unavailable' };
  }
  known(state: InspectEvidence['state']): { outcome: 'known'; value: InspectEvidence } {
    return { outcome: 'known', value: { id, state, exitCode: state === 'exited' ? 0 : null, oomKilled: false } };
  }
}
export function controlled(journal: JournalPort, time = clock(), backend = new ControlledBackend()) {
  const manager = new Supervisor({ journal, installationId, clock: time, backendFactory: () => backend });
  return { manager, backend, time };
}
