import { qualifyDaemon, requestDocker } from './daemon-client.js';
import {
  createEntry,
  absent,
  remember,
  retainIdentity,
  createdId,
  current,
  stopped,
  startFenced,
  existing,
  failedMutation,
  statusFailure,
  operationContext,
  rejected,
  uncertain,
  known,
} from './runtime-state.js';
import type { Entry, Inspection } from './runtime-state.js';
import {
  captureRuntimeAssociationPersistence,
  restoreRetiredAssociation,
  persistRetiredAssociation,
} from './runtime-association.js';
import type { RuntimeAssociationPersistence } from './runtime-association.js';
import { captureRetiredRuntimeBinding } from './retirement-binding.js';
import type { RetiredRuntimeBinding } from './retirement-binding.js';
import { performance } from 'node:perf_hooks';
import { resourceReading, unknownResources } from './resources.js';
import type { ResourceReading } from './resource-types.js';
import { isRuntimePlan } from './prepare.js';
import type { RuntimePlan } from './prepare.js';
import { inspectEvidence } from './inspect.js';
import type {
  CleanupEvidence,
  DockerTransport,
  FailureReason,
  InspectEvidence,
  MailboxArchiveReply,
  MutationResult,
  Observation,
  Operation,
} from './types.js';

/** Private adapter: lifetime fences are bounded and never evicted. Durable claims belong to the supervisor. */
export class DockerBackend {
  private readonly entries = new Map<string, Entry>();
  private active = 0;
  constructor(private readonly transport: DockerTransport) {}

  async inspect(plan: RuntimePlan, operation: Operation): Promise<Observation> {
    const context = operationContext(operation);
    if (!context || !isRuntimePlan(plan)) return { state: 'unknown', reason: 'invalid_input' };
    if (this.active >= 64) return { state: 'unknown', reason: 'overflow' };
    const entry = this.entry(plan);
    if (typeof entry === 'string') return { state: 'unknown', reason: entry };
    this.active++;
    try {
      const reason = await qualifyDaemon(this.transport, context, plan.spec.HostConfig.Runtime);
      return reason ? { state: 'unknown', reason } : current(entry, await this.observe(plan, context));
    } finally {
      this.active--;
    }
  }

  /** Reads only an existing inspected owner; never acquires a mutation lane. */
  async sampleResources(plan: RuntimePlan, operation: Operation): Promise<ResourceReading> {
    const context = operationContext(operation);
    if (!context || !isRuntimePlan(plan)) return unknownResources('invalid');
    const entry = this.entries.get(plan.name);
    if (!entry || entry.digest !== plan.specDigest) return unknownResources('invalid');
    if (!this.resourceOwner(entry)) return unknownResources('unavailable');
    if (this.active >= 64) return unknownResources('unavailable');
    const id = entry.runtimeId!;
    this.active++;
    try {
      const request = Object.freeze({
        ...context,
        deadline: Math.min(context.deadline, performance.now() + 1000),
        method: 'GET' as const,
        path: `/v1.47/containers/${id}/stats?stream=false&one-shot=true`,
      });
      const binding = Object.freeze({ id, method: request.method, path: request.path });
      const reply = await requestDocker(this.transport, request);
      if (!this.resourceOwner(entry) || entry.runtimeId !== id) return unknownResources('unavailable');
      return resourceReading(reply, binding, entry);
    } finally {
      this.active--;
    }
  }

  /** Active-plan read; ownership and telemetry credit survive actual HTTP close. */
  async readMailbox(plan: RuntimePlan, operation: Operation): Promise<MailboxArchiveReply> {
    const context = operationContext(operation);
    if (!context || !isRuntimePlan(plan)) return { ok: false, reason: 'invalid_input', dispatched: false };
    const entry = this.mailboxOwner(plan);
    const read = this.transport.readMailboxArchive?.bind(this.transport);
    if (!entry || !read) {
      return { ok: false, reason: 'unavailable', dispatched: false };
    }
    if (entry.readers || this.active >= 62) return { ok: false, reason: 'overflow', dispatched: false };
    const id = entry.runtimeId!;
    entry.readers++;
    this.active++;
    try {
      const reply = await read({ ...context, containerId: id });
      if (!this.currentMailbox(entry, id)) return { ok: false, reason: 'unsafe_state', dispatched: true };
      return reply;
    } catch {
      return { ok: false, reason: 'unavailable', dispatched: true };
    } finally {
      entry.readers--;
      this.active--;
    }
  }
  private currentMailbox(entry: Entry, id: string): boolean {
    return entry.volumeVerified && this.resourceOwner(entry) && entry.runtimeId === id;
  }
  private mailboxOwner(plan: RuntimePlan): Entry | undefined {
    const entry = this.entries.get(plan.name);
    return entry && entry.digest === plan.specDigest && entry.volumeVerified && this.resourceOwner(entry)
      ? entry
      : undefined;
  }
  private removeOrphan(entry: Entry, context: Operation): Promise<MutationResult<'removed'>> {
    if (!entry.removalClaimed && !(entry.volume && entry.createClaimed && entry.creationSettled)) {
      return Promise.resolve(rejected('cleanup_guard'));
    }
    entry.removed = true;
    entry.terminal = true;
    return this.removeVolume(entry, context);
  }
  private async removeVolume(entry: Entry, context: Operation): Promise<MutationResult<'removed'>> {
    const volume = await entry.volume?.remove(context);
    return volume && volume.outcome !== 'known' ? volume : known('removed');
  }

  private resourceOwner(entry: Entry): boolean {
    return entry.running && !entry.terminal && !entry.removed && entry.runtimeId !== undefined;
  }

  async ensureCreated(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      if (entry.retiredRuntimeId) return rejected('start_fenced');
      const before = current(entry, await this.observe(plan, context));
      if (before.state !== 'missing') return existing(before);
      if (entry.createClaimed) return uncertain('unavailable');
      const volume = await entry.volume?.prepare(context);
      if (volume && volume.outcome !== 'known') return volume;
      entry.createClaimed = true;
      return this.createContainer(plan, entry, context);
    });
  }

  private async createContainer(
    plan: RuntimePlan,
    entry: Entry,
    context: Operation,
  ): Promise<MutationResult<InspectEvidence>> {
    const created = await requestDocker(this.transport, {
      ...context,
      method: 'POST',
      path: `/v1.47/containers/create?name=${plan.name}`,
      body: plan.spec,
    });
    entry.creationSettled = created.ok || !created.dispatched;
    if (!created.ok) return failedMutation(created);
    if (created.status === 409) return existing(current(entry, await this.observe(plan, context)));
    if (created.status !== 201) return statusFailure(created.status);
    const id = createdId(created.body);
    if (!id) return uncertain('malformed');
    if (!retainIdentity(entry, id)) return uncertain('conflict');
    const after = current(entry, await this.observe(plan, context));
    if (!('id' in after) || after.id !== id) return uncertain('conflict');
    return known(after);
  }

  async dispatchStartOnce(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      if (startFenced(entry)) return rejected('start_fenced');
      const before = current(entry, await this.observe(plan, context));
      if (before.state === 'unknown') return existing(before);
      if (before.state !== 'created') return rejected('unsafe_state');
      if (startFenced(entry)) return rejected('start_fenced');
      // Set before dispatch; even an uncertain response must never permit another start.
      entry.startClaimed = true;
      const reply = await requestDocker(this.transport, {
        ...context,
        method: 'POST',
        path: `/v1.47/containers/${before.id}/start`,
      });
      if (!reply.ok) return failedMutation(reply);
      if (![204, 304].includes(reply.status)) return statusFailure(reply.status);
      const after = current(entry, await this.observe(plan, context));
      if (!('id' in after) || after.id !== before.id) return uncertain('unavailable');
      if (!['running', 'exited'].includes(after.state)) return uncertain('unsafe_state');
      return known(after);
    });
  }

  async stop(plan: RuntimePlan, operation: Operation, graceDeadline: number): Promise<MutationResult<InspectEvidence>> {
    if (!Number.isFinite(graceDeadline) || !isRuntimePlan(plan)) return rejected('invalid_input');
    const entry = this.entry(plan);
    if (typeof entry === 'string') return rejected(entry);
    entry.graceDeadline ??= graceDeadline;
    return this.terminate(plan, operation, (entry) => {
      const seconds = Math.max(0, Math.ceil(((entry.graceDeadline ?? graceDeadline) - performance.now()) / 1000));
      return Number.isSafeInteger(seconds) && seconds <= 2_147_483_647 ? `stop?t=${seconds}` : undefined;
    });
  }

  async kill(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.terminate(plan, operation, () => 'kill?signal=SIGKILL');
  }

  async remove(plan: RuntimePlan, operation: Operation, evidence: CleanupEvidence): Promise<MutationResult<'removed'>> {
    if (evidence?.sealed !== true || evidence.applicationAcknowledged !== true) return rejected('cleanup_guard');
    return this.run(plan, operation, async (entry, context) => {
      const before = current(entry, await this.observe(plan, context));
      if (entry.readers !== 0) return rejected('cleanup_guard');
      if (before.state === 'missing') return this.removeOrphan(entry, context);
      if (!stopped(before)) return rejected('cleanup_guard');
      entry.removalClaimed = true;
      const reply = await requestDocker(this.transport, {
        ...context,
        method: 'DELETE',
        path: `/v1.47/containers/${before.id}?force=false&v=false`,
      });
      if (!reply.ok) return failedMutation(reply);
      if (reply.status !== 204) return statusFailure(reply.status);
      entry.removed = true;
      entry.terminal = true;
      const after = current(entry, await this.observe(plan, context));
      return after.state === 'missing' ? this.removeVolume(entry, context) : uncertain('unavailable');
    });
  }

  /** C3 caller proves actual producer drain and exact released closure/ACK, not caller booleans. */
  async removeRetired(
    plan: RuntimePlan,
    operation: Operation,
    input: RetiredRuntimeBinding,
    associations?: RuntimeAssociationPersistence,
  ): Promise<MutationResult<'removed'>> {
    const binding = captureRetiredRuntimeBinding(input);
    if (!binding) return rejected('invalid_input');
    const persistence = captureRuntimeAssociationPersistence(associations);
    return this.run(
      plan,
      operation,
      async (entry, context) => {
        if (entry.readers !== 0) return rejected('cleanup_guard');
        if (entry.runtimeId && entry.runtimeId !== binding.runtimeId) return rejected('conflict');
        entry.retiredRuntimeId = binding.runtimeId;
        entry.runtimeId = binding.runtimeId;
        const before = current(entry, await this.observe(plan, context));
        if (before.state === 'missing') {
          await restoreRetiredAssociation(entry.volume, plan, binding, persistence);
          return this.removeRetiredVolume(entry, context);
        }
        if (!stopped(before)) return this.retiredObservationFailure(before);
        if (!(await persistRetiredAssociation(entry.volume, plan, binding, persistence)))
          return rejected('cleanup_guard');
        const reply = await requestDocker(this.transport, {
          ...context,
          method: 'DELETE',
          path: `/v1.47/containers/${binding.runtimeId}?force=false&v=false`,
        });
        if (!reply.ok) return failedMutation(reply);
        if (reply.status !== 204) return statusFailure(reply.status);
        entry.removed = true;
        entry.terminal = true;
        const after = current(entry, await this.observe(plan, context));
        return after.state === 'missing' ? this.removeRetiredVolume(entry, context) : uncertain('unavailable');
      },
      binding.daemonId,
    );
  }
  private retiredObservationFailure(before: Observation): MutationResult<'removed'> {
    return before.state === 'unknown'
      ? uncertain('reason' in before ? before.reason : 'unsafe_state')
      : rejected('cleanup_guard');
  }
  private async removeRetiredVolume(entry: Entry, context: Operation): Promise<MutationResult<'removed'>> {
    const result = await entry.volume?.removeRetired(context);
    if (result && result.outcome !== 'known') return result;
    entry.removed = true;
    entry.terminal = true;
    return known('removed');
  }

  private terminate(
    plan: RuntimePlan,
    operation: Operation,
    action: (entry: Entry) => string | undefined,
  ): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      const before = current(entry, await this.observe(plan, context, false));
      if (stopped(before)) return known(before);
      if (before.state === 'unknown') return existing(before);
      if (before.state !== 'running' && before.state !== 'restarting') return rejected('unsafe_state');
      const suffix = action(entry);
      if (!suffix) return rejected('unsupported');
      const reply = await requestDocker(this.transport, {
        ...context,
        method: 'POST',
        path: `/v1.47/containers/${before.id}/${suffix}`,
      });
      if (!reply.ok) return failedMutation(reply);
      if (![204, 304, 409].includes(reply.status)) return statusFailure(reply.status);
      const after = current(entry, await this.observe(plan, context, false));
      return stopped(after) && after.id === before.id ? known(after) : uncertain('unsafe_state');
    });
  }
  private async run<T>(
    plan: RuntimePlan,
    operation: Operation,
    execute: (entry: Entry, context: Operation) => Promise<MutationResult<T>>,
    daemonId?: string,
  ): Promise<MutationResult<T>> {
    const context = operationContext(operation);
    if (!context || !isRuntimePlan(plan)) return rejected('invalid_input');
    if (this.active >= 64) return rejected('overflow');
    const entry = this.entry(plan);
    if (typeof entry === 'string') return rejected(entry);
    if (entry.busy) return rejected('start_fenced');
    entry.busy = true;
    this.active++;
    try {
      const reason = await qualifyDaemon(this.transport, context, plan.spec.HostConfig.Runtime, daemonId);
      return reason ? rejected(reason) : await execute(entry, context);
    } finally {
      entry.busy = false;
      this.active--;
    }
  }
  private entry(plan: RuntimePlan): Entry | FailureReason {
    const existing = this.entries.get(plan.name);
    if (existing) return existing.digest === plan.specDigest ? existing : 'conflict';
    if (this.entries.size >= 64) return 'overflow';
    const entry = createEntry(plan, this.transport);
    this.entries.set(plan.name, entry);
    return entry;
  }
  private async observe(plan: RuntimePlan, context: Operation, verifyVolume = true): Promise<Inspection> {
    const entry = this.entries.get(plan.name);
    const runtimeIdAtIssue = entry?.runtimeId;
    const view = (observation: Observation): Inspection => ({ observation, runtimeIdAtIssue });
    const reply = await requestDocker(this.transport, {
      ...context,
      method: 'GET',
      path: this.observationPath(plan, entry),
    });
    if (!reply.ok) return view({ state: 'unknown', reason: reply.reason });
    if (reply.status === 404) return view(await this.retiredMissing(plan, entry, context, runtimeIdAtIssue));
    if (reply.status !== 200) return view({ state: 'unknown', reason: 'unavailable' });
    const checked = inspectEvidence(reply.body, plan);
    if (!checked.ok) return view({ state: 'unknown', reason: checked.reason });
    // Positive container identity fences old404s before asynchronous volume work.
    const observed = entry
      ? remember(entry, checked.value)
      : { state: 'unknown' as const, reason: 'overflow' as const };
    if (observed.state === 'unknown') return view(observed);
    const volumeReason = await this.verifyVolume(entry, context, verifyVolume);
    return view(volumeReason ? { state: 'unknown', reason: volumeReason } : observed);
  }
  private observationPath(plan: RuntimePlan, entry: Entry | undefined): string {
    return `/v1.47/containers/${entry?.retiredRuntimeId ?? plan.name}/json`;
  }
  private async retiredMissing(
    plan: RuntimePlan,
    entry: Entry | undefined,
    context: Operation,
    atIssue: string | undefined,
  ): Promise<Observation> {
    if (entry?.retiredRuntimeId) {
      const named = await requestDocker(this.transport, {
        ...context,
        method: 'GET',
        path: `/v1.47/containers/${plan.name}/json`,
      });
      if (!named.ok) return { state: 'unknown', reason: named.reason };
      if (named.status !== 404) return { state: 'unknown', reason: 'conflict' };
    }
    return absent(entry, atIssue);
  }
  private async verifyVolume(
    entry: Entry | undefined,
    context: Operation,
    required: boolean,
  ): Promise<FailureReason | undefined> {
    if (!entry?.volume || !required) return undefined;
    const volume = await entry.volume.verify(context);
    entry.volumeVerified = volume.outcome === 'known';
    return volume.outcome === 'known' ? undefined : volume.reason;
  }
}
