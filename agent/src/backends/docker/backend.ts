import { performance } from 'node:perf_hooks';
import { RuntimePlan } from './prepare.js';
import { compatibleVersion, containerId, inspectEvidence, record, supportedDaemon } from './inspect.js';
import type { CleanupEvidence, DockerReply, DockerRequest, DockerTransport, FailureReason,
  InspectEvidence, MutationResult, Observation, Operation } from './types.js';

interface Entry { readonly digest: string; busy: boolean; createClaimed: boolean; startClaimed: boolean }
const rejected = <T>(reason: FailureReason): MutationResult<T> => ({ outcome: 'rejected', reason });
const uncertain = <T>(reason: FailureReason): MutationResult<T> => ({ outcome: 'unknown', reason });
const known = <T>(value: T): MutationResult<T> => ({ outcome: 'known', value });

/** Private adapter: lifetime fences are bounded and never evicted. Durable claims belong to the supervisor. */
export class DockerBackend {
  private readonly entries = new Map<string, Entry>();
  private active = 0;
  constructor(private readonly transport: DockerTransport) {}

  async inspect(plan: RuntimePlan, operation: Operation): Promise<Observation> {
    const context = this.context(operation);
    if (!context || !(plan instanceof RuntimePlan)) return { state: 'unknown', reason: 'invalid_input' };
    if (this.active >= 64) return { state: 'unknown', reason: 'overflow' };
    this.active++;
    try {
      const reason = await this.qualify(context);
      return reason ? { state: 'unknown', reason } : await this.observe(plan, context);
    } finally { this.active--; }
  }

  async ensureCreated(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      const before = await this.observe(plan, context);
      if (before.state !== 'missing') return this.existing(before);
      if (entry.createClaimed) return uncertain('unavailable');
      entry.createClaimed = true;
      const created = await this.request({ ...context, method: 'POST',
        path: `/v1.47/containers/create?name=${plan.name}`, body: plan.spec });
      if (!created.ok) return this.failedMutation(created);
      if (created.status === 409) return this.existing(await this.observe(plan, context));
      if (created.status !== 201) return this.statusFailure(created.status);
      const id = record(created.body)?.Id;
      if (!containerId(id)) return uncertain('malformed');
      const after = await this.observe(plan, context);
      if (!('id' in after) || after.id !== id) return uncertain('conflict');
      return known(after);
    });
  }

  async dispatchStartOnce(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      if (entry.startClaimed) return rejected('start_fenced');
      const before = await this.observe(plan, context);
      if (before.state === 'unknown') return uncertain('reason' in before ? before.reason : 'unsafe_state');
      if (before.state !== 'created') return rejected('unsafe_state');
      // Set before dispatch; even an uncertain response must never permit another start.
      entry.startClaimed = true;
      const reply = await this.request({ ...context, method: 'POST', path: `/v1.47/containers/${before.id}/start` });
      if (!reply.ok) return this.failedMutation(reply);
      if (![204, 304].includes(reply.status)) return this.statusFailure(reply.status);
      const after = await this.observe(plan, context);
      if (!('id' in after) || after.id !== before.id) return uncertain('unavailable');
      if (!['running', 'exited'].includes(after.state)) return uncertain('unsafe_state');
      return known(after);
    });
  }

  async stop(plan: RuntimePlan, operation: Operation, graceDeadline: number): Promise<MutationResult<InspectEvidence>> {
    if (!Number.isFinite(graceDeadline)) return rejected('invalid_input');
    return this.terminate(plan, operation, context => {
      const seconds = Math.max(0, Math.floor((Math.min(context.deadline, graceDeadline) - performance.now()) / 1000));
      return `stop?t=${seconds}`;
    });
  }

  async kill(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.terminate(plan, operation, () => 'kill?signal=SIGKILL');
  }

  async remove(plan: RuntimePlan, operation: Operation, evidence: CleanupEvidence): Promise<MutationResult<'removed'>> {
    if (evidence?.sealed !== true || evidence.applicationAcknowledged !== true) return rejected('cleanup_guard');
    return this.run(plan, operation, async (_entry, context) => {
      const before = await this.observe(plan, context);
      if (!this.stopped(before)) return rejected('cleanup_guard');
      const reply = await this.request({ ...context, method: 'DELETE',
        path: `/v1.47/containers/${before.id}?force=false&v=false` });
      if (!reply.ok) return this.failedMutation(reply);
      if (reply.status !== 204) return this.statusFailure(reply.status);
      const after = await this.observe(plan, context);
      return after.state === 'missing' ? known('removed') : uncertain('unavailable');
    });
  }

  private terminate(plan: RuntimePlan, operation: Operation,
    action: (context: Operation) => string): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (_entry, context) => {
      const before = await this.observe(plan, context);
      if (this.stopped(before)) return known(before);
      if (before.state === 'unknown') return uncertain('reason' in before ? before.reason : 'unsafe_state');
      if (before.state !== 'running' && before.state !== 'restarting') return rejected('unsafe_state');
      const reply = await this.request({ ...context, method: 'POST',
        path: `/v1.47/containers/${before.id}/${action(context)}` });
      if (!reply.ok) return this.failedMutation(reply);
      if (![204, 304, 409].includes(reply.status)) return this.statusFailure(reply.status);
      const after = await this.observe(plan, context);
      return this.stopped(after) && after.id === before.id ? known(after) : uncertain('unsafe_state');
    });
  }

  private context(operation: Operation): Operation | undefined {
    if (!operation || !Number.isFinite(operation.deadline)) return undefined;
    return { deadline: Math.min(operation.deadline, performance.now() + 30_000),
      ...(operation.signal ? { signal: operation.signal } : {}) };
  }
  private async run<T>(plan: RuntimePlan, operation: Operation,
    execute: (entry: Entry, context: Operation) => Promise<MutationResult<T>>): Promise<MutationResult<T>> {
    const context = this.context(operation);
    if (!context || !(plan instanceof RuntimePlan)) return rejected('invalid_input');
    if (this.active >= 64) return rejected('overflow');
    const entry = this.entry(plan);
    if (typeof entry === 'string') return rejected(entry);
    if (entry.busy) return rejected('start_fenced');
    entry.busy = true; this.active++;
    try {
      const reason = await this.qualify(context);
      return reason ? rejected(reason) : await execute(entry, context);
    } finally { entry.busy = false; this.active--; }
  }
  private entry(plan: RuntimePlan): Entry | FailureReason {
    const existing = this.entries.get(plan.name);
    if (existing) return existing.digest === plan.specDigest ? existing : 'conflict';
    if (this.entries.size >= 64) return 'overflow';
    const entry = { digest: plan.specDigest, busy: false, createClaimed: false, startClaimed: false };
    this.entries.set(plan.name, entry);
    return entry;
  }
  private async qualify(context: Operation): Promise<FailureReason | undefined> {
    const version = await this.request({ ...context, method: 'GET', path: '/version' });
    if (!version.ok) return version.reason;
    if (version.status !== 200) return 'unavailable';
    if (!compatibleVersion(version.body)) return 'unsupported';
    const info = await this.request({ ...context, method: 'GET', path: '/v1.47/info' });
    if (!info.ok) return info.reason;
    if (info.status !== 200) return 'unavailable';
    if (!supportedDaemon(info.body)) return 'unsupported';
    return undefined;
  }
  private async observe(plan: RuntimePlan, context: Operation): Promise<Observation> {
    const reply = await this.request({ ...context, method: 'GET', path: `/v1.47/containers/${plan.name}/json` });
    if (!reply.ok) return { state: 'unknown', reason: reply.reason };
    if (reply.status === 404) return { state: 'missing' };
    if (reply.status !== 200) return { state: 'unknown', reason: 'unavailable' };
    const checked = inspectEvidence(reply.body, plan);
    return checked.ok ? checked.value : { state: 'unknown', reason: checked.reason };
  }
  private async request(input: DockerRequest): Promise<DockerReply> {
    if (input.signal?.aborted) return { ok: false, reason: 'aborted', dispatched: false };
    if (performance.now() >= input.deadline) return { ok: false, reason: 'deadline', dispatched: false };
    try {
      const reply = await this.transport.request(input);
      if (input.signal?.aborted) return { ok: false, reason: 'aborted', dispatched: true };
      if (performance.now() >= input.deadline) return { ok: false, reason: 'deadline', dispatched: true };
      return reply;
    }
    catch { return { ok: false, reason: 'unavailable', dispatched: true }; }
  }
  private stopped(observation: Observation): observation is InspectEvidence & { state: 'created' | 'exited' } {
    return observation.state === 'created' || observation.state === 'exited';
  }
  private existing(observation: Observation): MutationResult<InspectEvidence> {
    if (observation.state === 'unknown') return uncertain('reason' in observation ? observation.reason : 'unsafe_state');
    return 'id' in observation ? known(observation) : uncertain('conflict');
  }
  private failedMutation(reply: Extract<DockerReply, { ok: false }>): MutationResult<never> {
    return reply.dispatched ? uncertain(reply.reason) : rejected(reply.reason);
  }
  private statusFailure(status: number): MutationResult<never> {
    return [400, 401, 403, 404, 409].includes(status) ? rejected('rejected') : uncertain('unavailable');
  }
}
