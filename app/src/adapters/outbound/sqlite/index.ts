import type { RunExecutionReader } from '../../../ports/run-live-metrics.js';
import { captureExecutionReply } from './execution-binding/index.js';
import { artifactReadOperation, captureArtifactReadReply } from './run-artifacts/index.js';
import type { ArtifactReadOperation } from './run-artifacts/index.js';
import type { RunArtifactsReader } from '../../../ports/run-artifacts.js';
import { captureRunEventsReply } from './run-events/index.js';
import type { RunEventReader, RunEventsQuery } from '../../../ports/run-events.js';
import { absenceOperation, captureAbsenceReply } from './output-absence/index.js';
import type { AbsenceOperation } from './output-absence/index.js';
import type { OutputAbsenceStore } from '../../../ports/output-absence.js';
import type { OutputFinalizations } from '../../../ports/output-finalization.js';
import { finalizationOperation, captureFinalizationReply } from './output-finalization/index.js';
import type { FinalizationOperation } from './output-finalization/index.js';
import { captureResultReply } from './run-results/index.js';
import type { RunResultReader } from '../../../ports/run-results.js';
import type { RunKey } from '../../../ports/runs.js';
import type { OutputArtifactStore } from '../../../ports/output-artifacts.js';
import { outputOperation, captureOutputReply } from './output-custody/index.js';
import type { OutputOperation } from './output-custody/index.js';
import type { EventCustodyStore } from '../../../ports/events.js';
import { eventOperation, captureEventReply } from './event-custody/index.js';
import type { EventOperation } from './event-custody/index.js';
import type { RunStore, RunReader, RunCancellationStore, CancelRunCommand } from '../../../ports/runs.js';
import { captureCancelRunReply } from './run-cancellation-reply.js';
import type { DispatchStore } from '../../../ports/dispatch.js';
import type { InputStore } from '../../../ports/inputs.js';
import type { SuiteStore, SuiteReader } from '../../../ports/suites.js';
import { Worker } from 'node:worker_threads';
import type { SettingsScope } from '@beetle/contracts/api';
import type { NamespaceStore } from '../../../ports/namespaces.js';
import type { NamespaceEntity } from '../../../ports/namespaces.js';
import type { SettingsStore } from '../../../ports/settings.js';
import type { SettingsIdentity } from '../../../ports/settings-reader.js';
import { checkedBootstrap, checkedOperation, largeOperation, operationReplyLimit, boundedCopy } from './input.js';
import { dispatchOperation, captureDispatchReply } from './dispatch-wire.js';
import type { DispatchOperation } from './dispatch-wire.js';
import { captureWorkerReply } from './worker-reply.js';
import type { WorkerReply } from './worker-reply.js';
import { StorageError } from './protocol.js';
import type { Bootstrap, EntityKey, EntityPage, ErrorCode, ListQuery, Operation, RuntimeObservation, SettingsView, Value } from './protocol.js';
export { StorageError } from './protocol.js';
export type { RunConfiguration, RunProfilePin } from '../../../ports/runs.js';
export type { Bootstrap, EntityKey, EntityPage, ErrorCode, ListQuery, RuntimeObservation, SettingsView } from './protocol.js';

export interface MetadataOptions extends Bootstrap {
  path: string;
  /** Trusted matched compiled worker entrypoint supplied by the composition root. */
  workerUrl: URL;
  /** Includes in-flight work; maximum 64. Close has one reserved slot. */
  queueLimit?: number;
}
interface Pending { resolve(value: Value): void; reject(error: StorageError): void; timer: NodeJS.Timeout;
  artifacts?: ArtifactReadOperation; absence?: AbsenceOperation; finalization?: FinalizationOperation; result?: RunKey; execution?: RunKey; runEvents?: RunEventsQuery; output?: OutputOperation; large: boolean; replyLimit: number; event?: EventOperation; dispatch?: DispatchOperation; cancellation?: CancelRunCommand }
function validateLocation(options: MetadataOptions): void {
  if (typeof options.path !== 'string' || !options.path || options.path === ':memory:' || options.path.length > 4096 ||
    !(options.workerUrl instanceof URL) || options.workerUrl.protocol !== 'file:') throw new StorageError('invalid_input');
}
function validateOptions(options: MetadataOptions): Bootstrap {
  const limit = options.queueLimit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new StorageError('invalid_input');
  validateLocation(options);
  try { return checkedBootstrap({ installation: options.installation, runtime: options.runtime,
    ...(options.runs === undefined ? {} : { runs: options.runs }), runtimeTtlMs: options.runtimeTtlMs ?? 5000 }); }
  catch { throw new StorageError('invalid_input'); }
}

export class Metadata {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly limit: number;
  private readonly runtimeTtlMs: number;
  private nextId = 0;
  private closing = false;
  private failed = false;
  private closePromise: Promise<void> | undefined;
  private terminationPromise: Promise<number> | undefined;
  private readyResolve: () => void = () => undefined;
  private readyReject: (error: StorageError) => void = () => undefined;
  private readonly ready: Promise<void>;
  readonly absences: OutputAbsenceStore = {
    read: binding => this.call({ kind: 'absenceRead', binding }) as ReturnType<OutputAbsenceStore['read']>,
    adopt: request => this.call({ kind: 'absenceAdopt', request }) as ReturnType<OutputAbsenceStore['adopt']>,
    finalize: request => this.call({ kind: 'absenceFinalize', request }) as ReturnType<OutputAbsenceStore['finalize']>,
  };
  readonly finalizations: OutputFinalizations = {
    finalize: request => this.call({ kind: 'outputFinalize', request }) as ReturnType<OutputFinalizations['finalize']>,
  };
  readonly runEvents: RunEventReader = {
    getRunEvents: query => this.call({ kind: 'getRunEvents', query }) as ReturnType<RunEventReader['getRunEvents']>,
  };
  readonly runArtifacts: RunArtifactsReader = {
    listRunArtifacts: query => this.call({kind: 'listRunArtifacts', query}) as ReturnType<RunArtifactsReader['listRunArtifacts']>,
    getRunArtifact: key => this.call({kind: 'getRunArtifact', key}) as ReturnType<RunArtifactsReader['getRunArtifact']>,
  };
  readonly executions: RunExecutionReader = {
    getRunExecution: key => this.call({kind: 'getRunExecution', key}) as ReturnType<RunExecutionReader['getRunExecution']>,
  };
  readonly results: RunResultReader = {
    getRunResult: key => this.call({ kind: 'getRunResult', key }) as ReturnType<RunResultReader['getRunResult']>,
  };
  readonly outputs: OutputArtifactStore = {
    claimArtifact: request => this.call({kind: 'outputClaimArtifact', request}) as ReturnType<OutputArtifactStore['claimArtifact']>,
    recordProgress: request => this.call({kind: 'outputRecordProgress', request}) as ReturnType<OutputArtifactStore['recordProgress']>,
    beginPublication: request => this.call({kind: 'outputBeginPublication', request}) as ReturnType<OutputArtifactStore['beginPublication']>,
    recordPublication: request => this.call({kind: 'outputRecordPublication', request}) as ReturnType<OutputArtifactStore['recordPublication']>,
    scan: query => this.call({ kind: 'outputScan', query }) as ReturnType<OutputArtifactStore['scan']>,
    load: binding => this.call({ kind: 'outputLoad', binding }) as ReturnType<OutputArtifactStore['load']>,
    readSource: binding => this.call({ kind: 'outputReadSource', binding }) as ReturnType<OutputArtifactStore['readSource']>,
    adopt: request => this.call({ kind: 'outputAdopt', request }) as ReturnType<OutputArtifactStore['adopt']>,
  };
  readonly events: EventCustodyStore = {
    scan: query => this.call({ kind: 'eventScan', query }) as ReturnType<EventCustodyStore['scan']>,
    load: binding => this.call({ kind: 'eventLoad', binding }) as ReturnType<EventCustodyStore['load']>,
    ingest: request => this.call({ kind: 'eventIngest', request }) as ReturnType<EventCustodyStore['ingest']>,
    confirmAck: request => this.call({ kind: 'eventConfirmAck', request }) as ReturnType<EventCustodyStore['confirmAck']>,
    recordProblem: request => this.call({ kind: 'eventProblem', request }) as ReturnType<EventCustodyStore['recordProblem']>,
  };
  readonly runs: RunStore & RunReader & RunCancellationStore = {
    execute: command => this.call({ kind: 'run', command }) as ReturnType<RunStore['execute']>,
    getRun: key => this.call({ kind: 'getRun', key }) as ReturnType<RunReader['getRun']>,
    listRuns: query => this.call({ kind: 'listRuns', query }) as ReturnType<RunReader['listRuns']>,
    cancel: command => this.call({ kind: 'cancelRun', command }) as ReturnType<RunCancellationStore['cancel']>,
  };
  readonly dispatch: DispatchStore = {
    scan: query => this.call({ kind: 'dispatchScan', query }) as ReturnType<DispatchStore['scan']>,
    readOffer: key => this.call({ kind: 'dispatchReadOffer', key }) as ReturnType<DispatchStore['readOffer']>,
    claim: key => this.call({ kind: 'dispatchClaim', key }) as ReturnType<DispatchStore['claim']>,
    observe: request => this.call({ kind: 'dispatchObserve', request }) as ReturnType<DispatchStore['observe']>,
  };
  readonly inputs: InputStore = {
    control: command => this.call({ kind: 'input', command }) as ReturnType<InputStore['control']>,
    advance: command => this.call({ kind: 'advanceInput', command }) as ReturnType<InputStore['advance']>,
    get: key => this.call({ kind: 'getInput', key }) as ReturnType<InputStore['get']>,
    list: query => this.call({ kind: 'listInputs', query }) as ReturnType<InputStore['list']>,
    recovery: query => this.call({ kind: 'recoverInputs', query }) as ReturnType<InputStore['recovery']>,
    storage: () => this.call({ kind: 'inputStorage' }) as ReturnType<InputStore['storage']>,
  };
  readonly suites: SuiteStore & SuiteReader = {
    execute: command => this.call({ kind: 'suite', command }) as ReturnType<SuiteStore['execute']>,
    getSuite: key => this.call({ kind: 'getSuite', key }) as ReturnType<SuiteReader['getSuite']>,
    getRevision: key => this.call({ kind: 'getRevision', key }) as ReturnType<SuiteReader['getRevision']>,
    listSuites: query => this.call({ kind: 'listSuites', query }) as ReturnType<SuiteReader['listSuites']>,
    listRevisions: query => this.call({ kind: 'listRevisions', query }) as ReturnType<SuiteReader['listRevisions']>,
  };
  readonly namespaces: NamespaceStore = { execute: command => this.call({ kind: 'namespace', command }) as
    ReturnType<NamespaceStore['execute']> };
  readonly settings: SettingsStore = { execute: command => this.call({ kind: 'settings', command }) as
    ReturnType<SettingsStore['execute']> };

  private constructor(options: MetadataOptions, bootstrap: Bootstrap) {
    this.limit = options.queueLimit ?? 32;
    this.runtimeTtlMs = bootstrap.runtimeTtlMs ?? 5000;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker = new Worker(options.workerUrl, { workerData: { path: options.path, bootstrap },
      resourceLimits: { maxOldGenerationSizeMb: 128 } });
    this.worker.on('message', (reply: unknown) => this.receive(reply));
    this.worker.on('error', () => this.fail('unavailable'));
    this.worker.on('exit', () => this.fail('unavailable'));
  }
  static async open(options: MetadataOptions): Promise<Metadata> {
    const bootstrap = validateOptions(options);
    let metadata: Metadata;
    try { metadata = new Metadata(options, bootstrap); } catch { throw new StorageError('unavailable'); }
    const timer = setTimeout(() => metadata.fail('unavailable'), 5000);
    try { await metadata.ready; return metadata; }
    catch (error) { await metadata.terminate(); throw error; }
    finally { clearTimeout(timer); }
  }
  get(key: EntityKey): Promise<NamespaceEntity> {
    return this.call({ kind: 'get', key }) as Promise<NamespaceEntity>;
  }
  list(query: ListQuery): Promise<EntityPage> { return this.call({ kind: 'list', query }) as Promise<EntityPage>; }
  getSettings(scope: SettingsScope): Promise<SettingsView> {
    return this.call({ kind: 'getSettings', scope }) as Promise<SettingsView>;
  }
  /** Internal identity seam: does not resolve defaults or inspect runtime capacity. */
  getSettingsIdentity(scope: SettingsScope): Promise<SettingsIdentity> {
    return this.call({ kind: 'getSettingsIdentity', scope }) as Promise<SettingsIdentity>;
  }
  updateRuntime(runtime: RuntimeObservation | null): Promise<null> {
    return this.call({ kind: 'runtime', runtime }) as Promise<null>;
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.send({ kind: 'close' }).then(() => undefined).finally(() => this.terminate());
    return this.closePromise;
  }
  /** Pending writes may have committed; replay original intent after reopening. */
  async abort(): Promise<void> { this.closing = true; this.fail('unavailable'); await this.terminate(); }
  private call(operation: Operation): Promise<Value> {
    if (this.closing) return Promise.reject(new StorageError('closed'));
    if (this.failed) return Promise.reject(new StorageError('unavailable'));
    if (this.pending.size >= this.limit) return Promise.reject(new StorageError('queue_full'));
    if (largeOperation(operation) && [...this.pending.values()].filter(value => value.large).length >= 2) return Promise.reject(new StorageError('queue_full'));
    try { return this.send(checkedOperation(operation, this.runtimeTtlMs)); }
    catch { return Promise.reject(new StorageError('invalid_input')); }
  }
  private send(operation: Operation): Promise<Value> {
    if (this.failed) return Promise.reject(new StorageError('unavailable'));
    if (!Number.isSafeInteger(this.nextId) || this.nextId < 0 || this.nextId >= Number.MAX_SAFE_INTEGER) {
      this.fail('unavailable'); return Promise.reject(new StorageError('unavailable'));
    }
    const messageId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('unavailable'), 5000);
      this.pending.set(messageId, { resolve, reject, timer, large: largeOperation(operation),
        replyLimit: operationReplyLimit(operation), ...(absenceOperation(operation) ? { absence: operation } : {}), ...(finalizationOperation(operation) ? { finalization: operation } : {}), ...(outputOperation(operation) ? { output: operation } : {}), ...(eventOperation(operation) ? { event: operation } : {}), ...(dispatchOperation(operation) ? { dispatch: operation } : {}),

        ...(operation.kind === 'cancelRun' ? { cancellation: operation.command } : {}) });
      const pending = this.pending.get(messageId)!;
      this.bindReadRequest(pending, operation);
      try { this.worker.postMessage({ ...operation, messageId }); } catch { this.fail('unavailable'); }
    });
  }
  private receive(input: unknown): void {
    if (this.failed) return;
    let reply: WorkerReply;
    try { reply = captureWorkerReply(input); } catch { this.fail('unavailable'); return; }
    if (reply.kind === 'ready') { this.readyResolve(); return; }
    if (reply.kind === 'startup_error') { this.fail(reply.code); return; }
    const pending = this.pending.get(reply.messageId);
    if (!pending) { this.fail('unavailable'); return; }
    if (reply.ok) this.resolve(reply, pending);
    else {
      this.release(reply.messageId, pending);
      pending.reject(new StorageError(reply.code));
      if (reply.code === 'unavailable') this.fail('unavailable');
    }
  }
  private resolve(reply: Extract<WorkerReply, { kind: 'result'; ok: true }>, pending: Pending): void {
    let value: Value;
    try {
      value = this.readReply(pending, reply.value) ?? (pending.absence ? captureAbsenceReply(pending.absence, reply.value) : pending.finalization ? captureFinalizationReply(pending.finalization, reply.value) : pending.output ? captureOutputReply(pending.output, reply.value) : pending.event ? captureEventReply(pending.event, reply.value)
        : pending.dispatch ? captureDispatchReply(pending.dispatch, reply.value)
        : pending.cancellation ? captureCancelRunReply(reply.value, pending.cancellation)
        : boundedCopy(reply.value, pending.replyLimit) as Value);
    } catch { this.fail('unavailable'); return; }
    this.release(reply.messageId, pending);
    pending.resolve(value);
  }
  private bindReadRequest(pending: Pending, operation: Operation): void {
    if (operation.kind === 'getRunExecution') pending.execution = operation.key;
    if (artifactReadOperation(operation)) pending.artifacts = operation;
    if (operation.kind === 'getRunEvents') pending.runEvents = operation.query;
    if (operation.kind === 'getRunResult') pending.result = operation.key;
  }
  private readReply(pending: Pending, value: unknown): Value | undefined {
    if (pending.execution) return captureExecutionReply(pending.execution, value);
    if (pending.artifacts) return captureArtifactReadReply(pending.artifacts, value);
    if (pending.runEvents) return captureRunEventsReply(pending.runEvents, value);
    if (pending.result) return captureResultReply(pending.result, value);
    return undefined;
  }
  private release(messageId: number, pending: Pending): void {
    this.pending.delete(messageId); clearTimeout(pending.timer);
  }
  private fail(code: ErrorCode): void {
    if (this.failed) return;
    this.failed = true; this.readyReject(new StorageError(code));
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new StorageError(code)); }
    void this.terminate();
  }
  private terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate().then(code => { this.pending.clear(); return code; });
    return this.terminationPromise;
  }
}
export const openMetadata = Metadata.open;
