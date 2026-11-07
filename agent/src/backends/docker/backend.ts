import { performance } from 'node:perf_hooks';
import { RuntimePlan } from './prepare.js';
import { compatibleVersion, containerId, inspectEvidence, record, supportedDaemon } from './inspect.js';
import type { CleanupEvidence, DockerReply, DockerRequest, DockerTransport, FailureReason,
  InspectEvidence, MutationResult, Observation, Operation } from './types.js';

interface Entry {
  readonly digest: string; busy: boolean; createClaimed: boolean; startClaimed: boolean;
  runtimeId: string | undefined; terminal: boolean; removed: boolean; graceDeadline: number | undefined;
}
interface Inspection {
  readonly observation: Observation;
  readonly runtimeIdAtIssue: string | undefined;
}
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
    const entry = this.entry(plan);
    if (typeof entry === 'string') return { state: 'unknown', reason: entry };
    this.active++;
    try {
      const reason = await this.qualify(context, plan.spec.HostConfig.Runtime);
      return reason ? { state: 'unknown', reason } : this.current(entry, await this.observe(plan, context));
    } finally { this.active--; }
  }

  async ensureCreated(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      const before = this.current(entry, await this.observe(plan, context));
      if (before.state !== 'missing') return this.existing(before);
      if (entry.createClaimed) return uncertain('unavailable');
      entry.createClaimed = true;
      const created = await this.request({ ...context, method: 'POST',
        path: `/v1.47/containers/create?name=${plan.name}`, body: plan.spec });
      if (!created.ok) return this.failedMutation(created);
      if (created.status === 409) return this.existing(this.current(entry, await this.observe(plan, context)));
      if (created.status !== 201) return this.statusFailure(created.status);
      const id = this.createdId(created.body);
      if (!id) return uncertain('malformed');
      if (!this.retainIdentity(entry, id)) return uncertain('conflict');
      const after = this.current(entry, await this.observe(plan, context));
      if (!('id' in after) || after.id !== id) return uncertain('conflict');
      return known(after);
    });
  }

  async dispatchStartOnce(plan: RuntimePlan, operation: Operation): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      if (this.startFenced(entry)) return rejected('start_fenced');
      const before = this.current(entry, await this.observe(plan, context));
      if (before.state === 'unknown') return this.existing(before);
      if (before.state !== 'created') return rejected('unsafe_state');
      if (this.startFenced(entry)) return rejected('start_fenced');
      // Set before dispatch; even an uncertain response must never permit another start.
      entry.startClaimed = true;
      const reply = await this.request({ ...context, method: 'POST', path: `/v1.47/containers/${before.id}/start` });
      if (!reply.ok) return this.failedMutation(reply);
      if (![204, 304].includes(reply.status)) return this.statusFailure(reply.status);
      const after = this.current(entry, await this.observe(plan, context));
      if (!('id' in after) || after.id !== before.id) return uncertain('unavailable');
      if (!['running', 'exited'].includes(after.state)) return uncertain('unsafe_state');
      return known(after);
    });
  }

  async stop(plan: RuntimePlan, operation: Operation, graceDeadline: number): Promise<MutationResult<InspectEvidence>> {
    if (!Number.isFinite(graceDeadline) || !(plan instanceof RuntimePlan)) return rejected('invalid_input');
    const entry = this.entry(plan);
    if (typeof entry === 'string') return rejected(entry);
    entry.graceDeadline ??= graceDeadline;
    return this.terminate(plan, operation, entry => {
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
      const before = this.current(entry, await this.observe(plan, context));
      if (!this.stopped(before)) return rejected('cleanup_guard');
      const reply = await this.request({ ...context, method: 'DELETE',
        path: `/v1.47/containers/${before.id}?force=false&v=false` });
      if (!reply.ok) return this.failedMutation(reply);
      if (reply.status !== 204) return this.statusFailure(reply.status);
      entry.removed = true; entry.terminal = true;
      const after = this.current(entry, await this.observe(plan, context));
      return after.state === 'missing' ? known('removed') : uncertain('unavailable');
    });
  }

  private terminate(plan: RuntimePlan, operation: Operation,
    action: (entry: Entry) => string | undefined): Promise<MutationResult<InspectEvidence>> {
    return this.run(plan, operation, async (entry, context) => {
      const before = this.current(entry, await this.observe(plan, context));
      if (this.stopped(before)) return known(before);
      if (before.state === 'unknown') return this.existing(before);
      if (before.state !== 'running' && before.state !== 'restarting') return rejected('unsafe_state');
      const suffix = action(entry);
      if (!suffix) return rejected('unsupported');
      const reply = await this.request({ ...context, method: 'POST',
        path: `/v1.47/containers/${before.id}/${suffix}` });
      if (!reply.ok) return this.failedMutation(reply);
      if (![204, 304, 409].includes(reply.status)) return this.statusFailure(reply.status);
      const after = this.current(entry, await this.observe(plan, context));
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
      const reason = await this.qualify(context, plan.spec.HostConfig.Runtime);
      return reason ? rejected(reason) : await execute(entry, context);
    } finally { entry.busy = false; this.active--; }
  }
  private entry(plan: RuntimePlan): Entry | FailureReason {
    const existing = this.entries.get(plan.name);
    if (existing) return existing.digest === plan.specDigest ? existing : 'conflict';
    if (this.entries.size >= 64) return 'overflow';
    const entry: Entry = { digest: plan.specDigest, busy: false, createClaimed: false, startClaimed: false,
      runtimeId: undefined, terminal: false, removed: false, graceDeadline: undefined };
    this.entries.set(plan.name, entry);
    return entry;
  }
  private async qualify(context: Operation, runtime: string): Promise<FailureReason | undefined> {
    const version = await this.request({ ...context, method: 'GET', path: '/version' });
    if (!version.ok) return version.reason;
    if (version.status !== 200) return 'unavailable';
    if (!compatibleVersion(version.body)) return 'unsupported';
    const info = await this.request({ ...context, method: 'GET', path: '/v1.47/info' });
    if (!info.ok) return info.reason;
    if (info.status !== 200) return 'unavailable';
    if (!supportedDaemon(info.body) || record(info.body)?.DefaultRuntime !== runtime) return 'unsupported';
    return undefined;
  }
  private async observe(plan: RuntimePlan, context: Operation): Promise<Inspection> {
    const entry = this.entries.get(plan.name);
    const runtimeIdAtIssue = entry?.runtimeId;
    const view = (observation: Observation): Inspection => ({ observation, runtimeIdAtIssue });
    const reply = await this.request({ ...context, method: 'GET', path: `/v1.47/containers/${plan.name}/json` });
    if (!reply.ok) return view({ state: 'unknown', reason: reply.reason });
    if (reply.status === 404) return view(this.absent(entry, runtimeIdAtIssue));
    if (reply.status !== 200) return view({ state: 'unknown', reason: 'unavailable' });
    const checked = inspectEvidence(reply.body, plan);
    if (!checked.ok) return view({ state: 'unknown', reason: checked.reason });
    return view(entry ? this.remember(entry, checked.value) : { state: 'unknown', reason: 'overflow' });
  }
  private absent(entry: Entry | undefined, runtimeIdAtIssue: string | undefined): Observation {
    if (!entry) return { state: 'unknown', reason: 'overflow' };
    if (entry.runtimeId !== runtimeIdAtIssue) return { state: 'unknown', reason: 'unsafe_state' };
    if (runtimeIdAtIssue !== undefined) { entry.createClaimed = true; entry.startClaimed = true; entry.terminal = true; }
    return { state: 'missing' };
  }
  private remember(entry: Entry, evidence: InspectEvidence): Observation {
    if (!this.retainIdentity(entry, evidence.id)) return { state: 'unknown', reason: 'conflict' };
    if (this.regressive(entry, evidence)) return { state: 'unknown', reason: 'unsafe_state' };
    if (evidence.state !== 'created') entry.startClaimed = true;
    if (evidence.state === 'exited') entry.terminal = true;
    return evidence;
  }
  private retainIdentity(entry: Entry, id: string): boolean {
    if (entry.removed || entry.runtimeId && entry.runtimeId !== id) return false;
    entry.runtimeId ??= id; entry.createClaimed = true;
    return true;
  }
  private createdId(body: unknown): string | undefined {
    const id = record(body)?.Id;
    return containerId(id) ? id : undefined;
  }
  private regressive(entry: Entry, evidence: InspectEvidence): boolean {
    return entry.terminal && evidence.state !== 'exited' || entry.startClaimed && evidence.state === 'created';
  }
  private current(entry: Entry, view: Inspection): Observation {
    const { observation, runtimeIdAtIssue } = view;
    if (observation.state === 'missing' && entry.runtimeId !== runtimeIdAtIssue) return { state: 'unknown', reason: 'unsafe_state' };
    if (!('id' in observation)) return observation;
    if (entry.removed || entry.runtimeId !== observation.id) return { state: 'unknown', reason: 'conflict' };
    return this.regressive(entry, observation) ? { state: 'unknown', reason: 'unsafe_state' } : observation;
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
  private startFenced(entry: Entry): boolean { return entry.startClaimed || entry.terminal || entry.removed; }
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
