import { copyWrapperBatch } from '../control-protocol/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../control-protocol/index.js';
export type { WrapperBatch, WrapperCheckpoint, WrapperCursor } from '../control-protocol/index.js';
import { Worker } from 'node:worker_threads';
import type { Ack, AckReceipt, AgentEvent, AttemptSnapshot, ControlEvent, EventBatch, Offer } from '@beetle/contracts';
import { ackInput, cursorInput, DEFAULT_QUOTA_BYTES, eventInput, generationKey } from './event-input.js';
import { attemptKey, offerInput, pageInput, runnableInput } from './input.js';
import type { RunnablePage, RunnableRequest } from './protocol.js';
export type { RunnablePage, RunnableRequest } from './protocol.js';
import type { AdmissionCommand, AdmissionValue } from '../admission/index.js';
import { admissionInput, isOfferCommand } from './admission-input.js';
import { checkedSupervision } from './supervision.js';
import type { SupervisionCommand, SupervisionState } from './protocol.js';
export type { StopReason, SupervisionCommand, SupervisionState } from './protocol.js';
import type { AttemptKey, ErrorCode, GenerationKey, Operation, PageRequest, PruneReceipt, Reply, SnapshotPage, SourceCursors, SupervisorInput, Value } from './protocol.js';
export type { AttemptKey, ErrorCode, GenerationKey, PageRequest, PruneReceipt, SnapshotPage, SourceCursors, SupervisorInput } from './protocol.js';
export { configDigest } from './admission-input.js';

export class JournalError extends Error {
  constructor(readonly code: ErrorCode, readonly recovery?: AttemptSnapshot) { super(`Journal ${code}`); this.name = 'JournalError'; }
}
export interface JournalOptions {
  path: string;
  /** Trusted packaging option: compiled worker entrypoint. */
  workerUrl?: URL;
  /** Includes the in-flight command; hard maximum 64. */
  queueLimit?: number;
  /** Per-attempt durable charge limit for new offers, 1024..64 MiB. */
  spoolQuotaBytes?: number;
}
interface Pending { resolve(value: Value): void; reject(error: JournalError): void; timer: NodeJS.Timeout; large: boolean }

function validateQuota(quota: number): void {
  if (!Number.isSafeInteger(quota) || quota < 1024 || quota > DEFAULT_QUOTA_BYTES) throw new JournalError('invalid_input');
}
function validateOptions(options: JournalOptions): void {
  const limit = options.queueLimit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new JournalError('invalid_input');
  const quota = options.spoolQuotaBytes ?? DEFAULT_QUOTA_BYTES;
  validateQuota(quota);
  const path = options.path;
  if (typeof path !== 'string' || !path || path === ':memory:' || path.length > 4096) throw new JournalError('invalid_input');
}

export class Journal {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly limit: number;
  private nextId = 0;
  private largePending = 0;
  private closing = false;
  private failed = false;
  private closePromise: Promise<void> | undefined;
  private terminationPromise: Promise<number> | undefined;
  private readyResolve: () => void = () => undefined;
  private readyReject: (error: JournalError) => void = () => undefined;
  private readonly ready: Promise<void>;

  private constructor(options: JournalOptions) {
    this.limit = options.queueLimit ?? 32;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker = new Worker(options.workerUrl ?? new URL('./worker.js', import.meta.url), {
      workerData: { path: options.path, spoolQuotaBytes: options.spoolQuotaBytes ?? DEFAULT_QUOTA_BYTES }, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker.on('message', (reply: Reply) => this.receive(reply));
    this.worker.on('error', () => this.fail('unavailable'));
    this.worker.on('exit', () => this.fail('unavailable'));
  }

  static async open(options: JournalOptions): Promise<Journal> {
    validateOptions(options);
    let journal: Journal;
    try { journal = new Journal(options); } catch { throw new JournalError('unavailable'); }
    const timer = setTimeout(() => journal.fail('unavailable'), 5000);
    try { await journal.ready; return journal; }
    catch (error) { await journal.terminate(); throw error; }
    finally { clearTimeout(timer); }
  }

  immutableOffer(input: unknown): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'offer', ...offerInput(input) }), true) as Promise<AttemptSnapshot>;
  }
  /** Trusted supervisor/composition boundary; never expose as a wrapper or browser API. */
  admission(input: AdmissionCommand): Promise<AdmissionValue> {
    return this.prepare(() => ({ kind: 'admission', request: admissionInput(input) }), () => isOfferCommand(input)) as Promise<AdmissionValue>;
  }
  /** Private trusted supervisor clock/cancel transaction; never a wrapper/browser API. */
  supervision(input: SupervisionCommand): Promise<SupervisionState> {
    return this.prepare(() => {
      const request = { key: generationKey(input.key), now: input.now,
        ...(input.cancel !== undefined ? { cancel: input.cancel } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}) };
      checkedSupervision(request);
      return { kind: 'supervision', request };
    }) as Promise<SupervisionState>;
  }
  get(key: AttemptKey): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'get', key: attemptKey(key) })) as Promise<AttemptSnapshot>;
  }
  readOffer(key: AttemptKey): Promise<Offer> {
    return this.prepare(() => ({ kind: 'read', key: attemptKey(key) }), true) as Promise<Offer>;
  }
  durableCancel(key: AttemptKey): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'cancel', key: attemptKey(key) })) as Promise<AttemptSnapshot>;
  }
  listOpen(page: PageRequest): Promise<SnapshotPage> {
    return this.prepare(() => ({ kind: 'list', page: pageInput(page) })) as Promise<SnapshotPage>;
  }
  /** Private scheduler discovery; no offer/result payloads or historical rows. */
  scanRunnable(page: RunnableRequest): Promise<RunnablePage> {
    return this.prepare(() => ({ kind: 'runnable', page: runnableInput(page) })) as Promise<RunnablePage>;
  }

  readWrapperCheckpoint(key: GenerationKey): Promise<Readonly<WrapperCheckpoint> | null> {
    return this.prepare(() => ({ kind: 'checkpoint', key: generationKey(key) })) as Promise<WrapperCheckpoint | null>;
  }
  /** Private collector CAS: bounded events, projections, charges and cursor commit together. */
  commitWrapperBatch(input: WrapperBatch): Promise<Readonly<WrapperCheckpoint>> {
    return this.prepare(() => ({ kind: 'wrapperBatch', request: copyWrapperBatch(input) })) as Promise<WrapperCheckpoint>;
  }
  appendWrapper(input: ControlEvent): Promise<AgentEvent> {
    return this.prepare(() => ({ kind: 'append', event: eventInput(input, 'wrapper') })) as Promise<AgentEvent>;
  }
  /** One supervisor-owned ordinal stream per attempt/generation, durable across restart. */
  appendSupervisor(input: SupervisorInput): Promise<AgentEvent> {
    return this.prepare(() => ({ kind: 'append', event: eventInput(input, 'agent') })) as Promise<AgentEvent>;
  }
  readEvents(key: GenerationKey, after: number): Promise<EventBatch> {
    return this.prepare(() => ({ kind: 'events', key: generationKey(key), after: cursorInput(after) })) as Promise<EventBatch>;
  }
  /** Application-durable control storage only; no lifecycle/finalization effects. */
  acknowledge(input: Ack): Promise<AckReceipt> {
    return this.prepare(() => ({ kind: 'ack', ack: ackInput(input) })) as Promise<AckReceipt>;
  }
  sourceCursors(key: GenerationKey): Promise<SourceCursors> {
    return this.prepare(() => ({ kind: 'sources', key: generationKey(key) })) as Promise<SourceCursors>;
  }
  prune(key: GenerationKey): Promise<PruneReceipt> {
    return this.prepare(() => ({ kind: 'prune', key: generationKey(key) })) as Promise<PruneReceipt>;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    // Worker FIFO drains previously posted commands; close uses one reserved slot.
    this.closePromise = this.send({ kind: 'close' }).then(() => undefined).finally(() => this.terminate());
    return this.closePromise;
  }

  /** Immediate shutdown: pending writes have unknown commit outcome. */
  async abort(): Promise<void> { this.closing = true; this.fail('unavailable'); await this.terminate(); }

  private refusal(): ErrorCode | null {
    if (this.closing) return 'closed';
    if (this.failed) return 'unavailable';
    return this.pending.size >= this.limit ? 'queue_full' : null;
  }
  private prepare(operation: () => Operation, large: boolean | (() => boolean) = false): Promise<Value> {
    const refusal = this.refusal();
    if (refusal) return Promise.reject(new JournalError(refusal));
    let reserved = false;
    try {
      const holdsLarge = typeof large === 'function' ? large() : large;
      if (holdsLarge && this.largePending >= 2) return Promise.reject(new JournalError('queue_full'));
      if (holdsLarge) { this.largePending++; reserved = true; }
      return this.send(operation(), holdsLarge);
    } catch {
      if (reserved) this.largePending--;
      return Promise.reject(new JournalError('invalid_input'));
    }
  }

  private send(operation: Operation, large = false): Promise<Value> {
    if (this.failed) return Promise.reject(new JournalError('unavailable'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('unavailable'), 5000);
      this.pending.set(id, { resolve, reject, timer, large });
      try { this.worker.postMessage({ ...operation, id }); } catch { this.fail('unavailable'); }
    });
  }

  private receive(reply: Reply): void {
    if (reply.kind === 'ready') { this.readyResolve(); return; }
    if (reply.kind === 'startup_error') { this.fail(reply.code); return; }
    const pending = this.pending.get(reply.id);
    if (!pending) { this.fail('unavailable'); return; }
    this.pending.delete(reply.id); clearTimeout(pending.timer);
    if (pending.large) this.largePending--;
    if (reply.ok) pending.resolve(reply.value);
    else {
      pending.reject(new JournalError(reply.code, reply.recovery));
      if (reply.code === 'unavailable') this.fail('unavailable');
    }
  }

  private fail(code: ErrorCode): void {
    if (this.failed) return;
    this.failed = true;
    this.readyReject(new JournalError(code));
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new JournalError(code)); }
    this.pending.clear();
    void this.terminate();
  }

  private terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate();
    return this.terminationPromise;
  }
}

export const openJournal = Journal.open;
