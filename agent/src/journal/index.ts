import { createSettlementClient } from './settlement-client.js';
import type { JournalSettlements } from './settlement-client.js';
import {createRuntimeAssociationClient} from './runtime-association-client.js';
import type {JournalRuntimeAssociations} from '../runtime-association/index.js';
import { createCleanupReceiptClient } from './cleanup-receipt-client.js';
import type { JournalCleanupReceipts } from '../cleanup-control/index.js';
import { createCleanupProgressClient } from './cleanup-progress-client.js';
import type { JournalCleanupProgress } from '../cleanup-control/index.js';
import { createCleanupPlanClient } from './cleanup-plan-client.js';
import type { JournalCleanupPlans } from '../cleanup-control/index.js';
import type { JournalRejectedFunding } from './retirement-client.js';
import { createRetirementClient } from './retirement-client.js';
import type { JournalRetirements } from '../retirement-values/index.js';
import { createStagingNamespaceClient } from './staging-namespace-client.js';
import type { StagingNamespaceJournal } from '../staging-namespace/index.js';
import { captureExport } from './export-assignment.js';
import { copyWrapperBatch } from '../control-protocol/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../control-protocol/index.js';
export type { WrapperBatch, WrapperCheckpoint, WrapperCursor } from '../control-protocol/index.js';
import { isJournalAuthority } from './authority.js';
import { Worker } from 'node:worker_threads';
import type { Ack, AckReceipt, AgentEvent, AttemptSnapshot, ControlEvent, EventBatch, Offer, StandaloneExportAssignment } from '@beetle/contracts';
import { ackInput, cursorInput, DEFAULT_QUOTA_BYTES, eventInput, generationKey } from './event-input.js';
import { attemptKey, offerInput, pageInput, runnableInput } from './input.js';
import type { RunnablePage, RunnableRequest } from './protocol.js';
export type { RunnablePage, RunnableRequest } from './protocol.js';
import type { AdmissionCommand, AdmissionValue, Reservation, Scope } from '../admission/index.js';
import type { CollectionIntent, CollectedSource, PrivateSource, SourceReceipt } from '../output-source/index.js';
import type { JournalOutputSources, OutputSourceOperation, FailedOutputCollection } from './output-source-protocol.js';
import type { JournalOutputDelivery, OutputDeliveryClosure, OutputDeliveryOperation } from './output-delivery-protocol.js';
export type { JournalOutputDelivery, OutputDeliveryClosure } from './output-delivery-protocol.js';
import { OUTPUT_DELIVERY_BYTES } from './output-delivery-protocol.js';
import { deliveryReply } from './delivery-input.js';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { OutputAbsence, Owned } from '@beetle/contracts/output-source';
import type { JournalOutputAbsence, OutputAbsenceOperation } from './output-absence-protocol.js';
export type { JournalOutputAbsence } from './output-absence-protocol.js';
export type { JournalOutputSources, FailedOutputCollection } from './output-source-protocol.js';
import { captureCollectionIntent, prepareOutputSource, receiptForOutputSource, copyReceipt, copyFailed,
  sourceHash, sourceJson, sourceCaps, sameSource, sourceScope, intentReply, sourceReply, reservationReply } from './output-source-input.js';
import { admissionInput, isOfferCommand } from './admission-input.js';
import { checkedSupervision } from './supervision.js';
import { captureCancelledOriginal, captureCancelledExportOriginal } from './cancel-original-input.js';
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
function largeOperation(operation: Operation): boolean {
  return ['cleanupReceiptRead', 'cleanupReceiptCommit', 'cleanupProgressRead', 'cleanupProgressBegin', 'cleanupProgressAdvance', 'cleanupPlanRead', 'cleanupPlanStore', 'outputCollectionBegin', 'outputCollectionRead', 'outputSourceCommit', 'outputSourceRead', 'outputSourceRelease', 'outputCollectionFailed',
    'outputDeliveryClose', 'outputDeliveryRead', 'outputAbsenceClose', 'outputAbsenceRead'].includes(operation.kind)
    || operation.kind === 'offer' || operation.kind === 'cancelOriginal' || operation.kind === 'read' || operation.kind === 'readExportAssignment'
    || operation.kind === 'admission' && operation.request.kind === 'offer';
}

export class Journal implements JournalOutputSources, JournalOutputDelivery, JournalOutputAbsence {
  readonly runtimeAssociations:JournalRuntimeAssociations;
  readonly retirements: JournalRetirements & JournalRejectedFunding;
  readonly cleanupPlans: JournalCleanupPlans;
  readonly cleanupProgress: JournalCleanupProgress;
  readonly cleanupReceipts: JournalCleanupReceipts;
  readonly stagingNamespace: StagingNamespaceJournal;
  readonly settlements:JournalSettlements;
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
    this.settlements=createSettlementClient({send:operation=>this.prepare(operation,true),invalidReply:()=>{this.fail('unavailable');throw new JournalError('unavailable');},settleCarrier:()=>this.retirements.settleCarrier(),owner:()=>this.retirements});
    this.runtimeAssociations=createRuntimeAssociationClient({send:operation=>this.prepare(operation),invalidReply:()=>{this.fail('unavailable');throw new JournalError('unavailable');},settleCarrier:()=>this.retirements.settleCarrier()});
    this.cleanupReceipts = createCleanupReceiptClient({ send: operation => this.prepare(operation, true),
      invalidReply: () => { this.fail('unavailable'); throw new JournalError('unavailable'); },
      settleCarrier: () => this.retirements.settleCarrier() });
    this.cleanupProgress = createCleanupProgressClient({ send: operation => this.prepare(operation, true),
      invalidReply: () => { this.fail('unavailable'); throw new JournalError('unavailable'); },
      settleCarrier: () => this.retirements.settleCarrier() });
    this.cleanupPlans = createCleanupPlanClient({ send: operation => this.prepare(operation, true),
      invalidReply: () => { this.fail('unavailable'); throw new JournalError('unavailable'); },
      settleCarrier: () => this.retirements.settleCarrier() });
    this.retirements = createRetirementClient({ send: operation => this.prepare(operation),
      invalidReply: () => { throw new JournalError('unavailable'); },
      settleCarrier: () => this.failed ? this.terminate().then(() => undefined) : Promise.resolve() });
    this.stagingNamespace = createStagingNamespaceClient({ send: operation => this.prepare(operation),
      invalidReply: () => { this.fail('unavailable'); throw new JournalError('unavailable'); } });
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

  /** Durable private composition identity; old or damaged journals require recovery. */
  async journalAuthority(): Promise<string> {
    const value = await this.prepare(() => ({ kind: 'authority' }));
    if (!isJournalAuthority(value)) {
      this.fail('unavailable');
      throw new JournalError('unavailable');
    }
    return value;
  }

  immutableOffer(input: unknown): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'offer', ...offerInput(input) }), true) as Promise<AttemptSnapshot>;
  }
  /** Captures one original and trusted local time; shares Offer's two large credits. */
  cancelOriginal(input: { offer: unknown; now: number }): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'cancelOriginal', ...captureCancelledOriginal(input) }), true) as Promise<AttemptSnapshot>;
  }
  cancelExportOriginal(input: {assignment:unknown;now:number}): Promise<AttemptSnapshot> {
    return this.prepare(()=>({kind:'cancelOriginal',...captureCancelledExportOriginal(input)}),true) as Promise<AttemptSnapshot>;
  }
  /** Trusted supervisor/composition boundary; never expose as a wrapper or browser API. */
  admission(input: AdmissionCommand): Promise<AdmissionValue> {
    return this.prepare(() => ({ kind: 'admission', request: admissionInput(input) }), () => isOfferCommand(input)) as Promise<AdmissionValue>;
  }
  private output<T>(prepare: () => OutputSourceOperation | OutputDeliveryOperation | OutputAbsenceOperation, validate: (value: Value) => T): Promise<T> {
    return this.prepare(prepare, true).then(value => {
      try { return validate(value); }
      catch { this.fail('unavailable'); throw new JournalError('unavailable'); }
    });
  }
  beginOutputCollection(input: CollectionIntent): Promise<CollectionIntent> {
    let expected: CollectionIntent;
    return this.output(() => {
      expected = captureCollectionIntent(input);
      return { kind: 'outputCollectionBegin', json: sourceJson(expected, sourceCaps.outputCollectionBegin) };
    }, value => {
      const result = intentReply(value, expected.binding);
      if (!sameSource(result, expected)) throw new Error('Unexpected intent reply'); return result;
    });
  }
  readOutputCollection(key: Scope): Promise<CollectionIntent | null> {
    let expected: Scope;
    return this.output(() => ({ kind: 'outputCollectionRead', key: expected = sourceScope(key) }),
      value => value === null ? null : intentReply(value, expected));
  }
  commitOutputSource(input: CollectedSource): Promise<SourceReceipt> {
    let expected: SourceReceipt;
    return this.output(() => {
      const source = prepareOutputSource(input, sourceHash); expected = receiptForOutputSource(source, sourceHash);
      return { kind: 'outputSourceCommit', json: sourceJson(source, sourceCaps.outputSourceCommit) };
    }, value => {
      const result = copyReceipt(value);
      if (!sameSource(result, expected)) throw new Error('Unexpected source receipt'); return result;
    });
  }
  readOutputSource(key: Scope): Promise<PrivateSource | null> {
    let expected: Scope;
    return this.output(() => ({ kind: 'outputSourceRead', key: expected = sourceScope(key) }),
      value => value === null ? null : sourceReply(value, expected));
  }
  releaseOutputSource(receipt: SourceReceipt): Promise<Reservation> {
    let expected: SourceReceipt;
    return this.output(() => ({ kind: 'outputSourceRelease', json: sourceJson(expected = copyReceipt(receipt), sourceCaps.outputSourceRelease) }),
      value => {
        const result = reservationReply(value, expected.key);
        if (result.releaseEvidence?.collection.state !== 'finished') throw new Error('Unexpected source release reply'); return result;
      });
  }
  failOutputCollection(input: FailedOutputCollection): Promise<Reservation> {
    let expected: FailedOutputCollection;
    return this.output(() => ({ kind: 'outputCollectionFailed', json: sourceJson(expected = copyFailed(input), sourceCaps.outputCollectionFailed) }),
      value => {
        const result = reservationReply(value, expected.evidence.key);
        if (!sameSource(result.releaseEvidence, expected.evidence)) throw new Error('Unexpected failed release reply'); return result;
      });
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
  async readExportAssignment(key: AttemptKey): Promise<StandaloneExportAssignment | null> {
    const value=await this.prepare(() => ({kind:'readExportAssignment',key:attemptKey(key)}),true);
    if (value === null) return null;
    try {return captureExport(value);} catch {this.fail('unavailable');throw new JournalError('unavailable');}
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
    let prepared: Operation;
    try {
      const holdsLarge = typeof large === 'function' ? large() : large;
      if (holdsLarge && this.largePending >= 2) return Promise.reject(new JournalError('queue_full'));
      if (holdsLarge) { this.largePending++; reserved = true; }
      prepared = operation();
    } catch {
      return Promise.reject(new JournalError('invalid_input'));
    } finally { if (reserved) this.largePending--; }
    return this.send(prepared);
  }

  private send(operation: Operation): Promise<Value> {
    if (this.failed) return Promise.reject(new JournalError('unavailable'));
    if (operation.kind !== 'close') {
      const refusal = this.refusal();
      if (refusal) return Promise.reject(new JournalError(refusal));
    }
    // Only the validated snapshot authorizes accounting; caller hints can change.
    const large = largeOperation(operation);
    if (large && this.largePending >= 2) return Promise.reject(new JournalError('queue_full'));
    if (large) this.largePending++;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('unavailable'), 5000);
      this.pending.set(id, { resolve, reject, timer, large });
      try { this.worker.postMessage({ ...operation, id }); } catch { this.fail('unavailable'); }
    });
  }
  /** Call only after the owning producer barrier; worker captures the durable stream end. */
  closeOutputDelivery(receipt: SourceReceipt): Promise<OutputDeliveryClosure> {
    let expected: SourceReceipt;
    return this.output(() => ({ kind: 'outputDeliveryClose', json: sourceJson(expected = copyReceipt(receipt), OUTPUT_DELIVERY_BYTES) }),
      value => deliveryReply(value, expected));
  }
  readOutputDelivery(key: Scope): Promise<OutputDeliveryClosure | null> {
    let expected: Scope;
    return this.output(() => ({ kind: 'outputDeliveryRead', key: expected = sourceScope(key) }),
      value => value === null ? null : deliveryReply(value, expected));
  }

  /** Trusted owner must retire native producers before requesting durable closure. */
  closeOutputAbsence(key: Scope): Promise<Owned<OutputAbsence> | null> { return this.absence('outputAbsenceClose', key); }
  readOutputAbsence(key: Scope): Promise<Owned<OutputAbsence> | null> { return this.absence('outputAbsenceRead', key); }
  private absence(kind: OutputAbsenceOperation['kind'], key: Scope): Promise<Owned<OutputAbsence> | null> {
    let expected: Scope;
    return this.output(() => ({ kind, key: expected = sourceScope(key) }), value => {
      if (value === null) return null;
      const proof = captureOutputAbsence(value);
      for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) {
        if (proof[field] !== expected[field]) throw new Error('Unexpected absence scope');
      }
      return proof;
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
    void this.terminate().catch(()=>{});
  }

  private terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate();
    return this.terminationPromise;
  }
}

export const openJournal = Journal.open;
