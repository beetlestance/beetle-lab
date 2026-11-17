import { performance } from 'node:perf_hooks';
import type { Observation, Operation } from '../backends/docker/index.js';
import { validateReleasedReservation } from './identity.js';
import { SupervisorError } from './types.js';
import type { BackendPort, JournalPort, LaunchInput } from './types.js';

/** Read-only recovery, after all actual actor lanes drain. No clock gate or event capture. */
export async function inspectReleased(input: {
  journal: JournalPort;
  backend: BackendPort;
  launch: LaunchInput;
  operation: Operation;
}): Promise<void> {
  const { journal, backend, launch, operation } = input;
  checkBudget(operation);
  const snapshot = await journal.get(launch.key);
  checkBudget(operation);
  if (snapshot.admission?.state !== 'released' || snapshot.admission.disposition !== 'settled') {
    throw new SupervisorError('conflict');
  }
  const current = await journal.admission({ kind: 'reservation', key: launch.key });
  checkBudget(operation);
  if (!('status' in current)) throw new SupervisorError('conflict');
  const offer = await journal.readOffer(launch.key);
  checkBudget(operation);
  validateReleasedReservation(launch, current, offer);
  checkBudget(operation);
  const view = await inspect(backend, launch, operation);
  checkBudget(operation);
  // Missing is meaningful only with the exact validated release and fenced actor.
  if (view.state === 'missing') return;
  if (!('id' in view) || view.id !== current.runtimeId || !['created', 'exited'].includes(view.state)) {
    throw new SupervisorError('backend_unavailable');
  }
}
async function inspect(backend: BackendPort, launch: LaunchInput, operation: Operation): Promise<Observation> {
  try {
    return await backend.inspect(launch.plan, operation);
  } catch {
    throw new SupervisorError('backend_unavailable');
  }
}
function checkBudget(operation: Operation): void {
  if (!Number.isFinite(operation.deadline) || performance.now() >= operation.deadline || operation.signal?.aborted) {
    throw new SupervisorError('backend_unavailable');
  }
}

interface RetirementOptions {
  hasPending(): boolean;
  originals(): readonly (Promise<unknown> | undefined)[];
  evidencePending(): boolean;
  fence(): void;
  closeTelemetry(): Promise<void>;
  inspect(operation: Operation): Promise<void>;
}
export class ActorRetirement {
  constructor(private readonly options: RetirementOptions) {}
  private retirement: Promise<void> | undefined;
  private retirementFailed = false;
  private ownedRetirement: Promise<void> | undefined;
  private retirementReady = false;
  private isRetiring = false;
  retire(): void {
    if (this.isRetiring && !this.retirementReady) throw new SupervisorError('conflict');
    if (this.options.hasPending()) throw new SupervisorError('conflict');
    this.options.fence();
  }
  retireOwned(): Promise<void> {
    this.isRetiring = true;
    this.ownedRetirement ??= Promise.resolve().then(async () => {
      await this.options.closeTelemetry();
      if (this.options.hasPending()) throw new SupervisorError('conflict');
      this.retirementReady = true;
    });
    void this.ownedRetirement.catch(() => {
      this.retirementFailed = true;
    });
    return this.ownedRetirement;
  }
  retireReleased(operation: Operation): Promise<void> {
    this.isRetiring = true;
    if (this.retirement) return this.retirement;
    this.retirement = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled(this.options.originals());
      if (outcomes.some((value) => value.status === 'rejected') || this.options.evidencePending())
        this.retirementFailed = true;
      if (this.retirementFailed) throw new SupervisorError('conflict');
      await this.options.closeTelemetry();
      await this.options.inspect(operation);
      this.retirementReady = true;
    });
    const original = this.retirement;
    void original.catch(() => {
      if (!this.retirementFailed && this.retirement === original) this.retirement = undefined;
    });
    return original;
  }
  get retiring(): boolean {
    return this.isRetiring;
  }
}
