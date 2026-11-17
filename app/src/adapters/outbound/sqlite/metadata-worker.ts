import { reportWorkerFailure, notifyWorkerFailure } from './failure-diagnostic.js';

import type { MetadataOptions } from './options.js';

import { captureNamespaceDeletionReply } from './namespace-deletion/index.js';

import type { NamespaceDeletionOperation } from './namespace-deletion/index.js';

import { retentionOperation, captureRetentionReply } from './retention-wire/index.js';

import type { RetentionOperation } from '../../../ports/retention.js';

import { settlementOperation, captureSettlementValue } from './backend-settlement/index.js';

import type { BackendSettlementOperation } from '../../../ports/output-settlement-metadata.js';

import { captureHistoryReply, historyOperation } from './run-history/index.js';

import type { HistoryOperation } from './run-history/index.js';

import { exportOperation, captureExportReply } from './export-wire.js';

import type { ExportOperation } from './export-wire.js';

import { localSessionOperation, captureLocalSessionReply } from './local-session/index.js';

import type { LocalSessionOperation } from '../../../ports/local-session.js';

import { deletionOperation, captureDeletionReply } from './output-deletion/index.js';

import type { OutputDeletionOperation } from '../../../ports/output-deletion-metadata.js';

import { captureExecutionReply } from './execution-binding/index.js';

import { artifactReadOperation, captureArtifactReadReply } from './run-artifacts/index.js';

import type { ArtifactReadOperation } from './run-artifacts/index.js';

import { captureRunEventsReply } from './run-events/index.js';

import type { RunEventsQuery } from '../../../ports/run-events.js';

import { absenceOperation, captureAbsenceReply } from './output-absence/index.js';

import type { AbsenceOperation } from './output-absence/index.js';

import { finalizationOperation, captureFinalizationReply } from './output-finalization/index.js';

import type { FinalizationOperation } from './output-finalization/index.js';

import { captureResultReply } from './run-results/index.js';

import type { RunKey } from '../../../ports/runs.js';

import { outputOperation, captureOutputReply } from './output-custody/index.js';

import type { OutputOperation } from './output-custody/index.js';

import { eventOperation, captureEventReply } from './event-custody/index.js';

import type { EventOperation } from './event-custody/index.js';

import type { CancelRunCommand } from '../../../ports/runs.js';

import { captureCancelRunReply } from './run-cancellation-reply.js';

import { Worker } from 'node:worker_threads';

import { checkedOperation, largeOperation, operationReplyLimit, boundedCopy } from './input.js';

import { dispatchOperation, captureDispatchReply } from './dispatch-wire.js';

import type { DispatchOperation } from './dispatch-wire.js';

import { captureWorkerReply } from './worker-reply.js';

import type { WorkerReply } from './worker-reply.js';

import { StorageError } from './protocol.js';

import type { Bootstrap, ErrorCode, Operation, Value } from './protocol.js';

interface Pending {
  namespaceDeletion?: NamespaceDeletionOperation;
  retention?: RetentionOperation;
  settlement?: BackendSettlementOperation;
  history?: HistoryOperation;
  exportJob?: ExportOperation;
  localSession?: LocalSessionOperation;
  deletion?: OutputDeletionOperation;
  resolve(value: Value): void;
  reject(error: StorageError): void;
  operation: Operation['kind'];
  artifacts?: ArtifactReadOperation;
  absence?: AbsenceOperation;
  finalization?: FinalizationOperation;
  result?: RunKey;
  execution?: RunKey;
  runEvents?: RunEventsQuery;
  output?: OutputOperation;
  large: boolean;
  replyLimit: number;
  event?: EventOperation;
  dispatch?: DispatchOperation;
  cancellation?: CancelRunCommand;
}
/** Owns the native metadata worker, bounded mailbox and physical termination. */
export abstract class MetadataWorker {
  private readonly worker: Worker;

  private readonly pending = new Map<number, Pending>();

  private readonly limit: number;

  private readonly runtimeTtlMs: number;

  private progressTimer: NodeJS.Timeout | undefined;

  private nextId = 0;

  private closing = false;

  protected failed = false;

  private readonly onFailure: ((error: StorageError) => void) | undefined;

  storageStatus(): 'ready' | 'closing' | 'unavailable' {
    return this.failed ? 'unavailable' : this.closing ? 'closing' : 'ready';
  }

  private closePromise: Promise<void> | undefined;

  private terminationPromise: Promise<number> | undefined;

  private readyResolve: () => void = () => undefined;

  private readyReject: (error: StorageError) => void = () => undefined;

  protected readonly ready: Promise<void>;

  protected constructor(options: MetadataOptions, bootstrap: Bootstrap) {
    this.onFailure = options.onFailure?.bind(options);
    this.limit = options.queueLimit ?? 32;
    this.runtimeTtlMs = bootstrap.runtimeTtlMs ?? 5000;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker = new Worker(options.workerUrl, {
      workerData: {
        path: options.path,
        bootstrap,
        ...(options.readOnly ? { readOnly: true, historicalIdentity: options.historicalIdentity } : {}),
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker.on('message', (reply: unknown) => this.receive(reply));
    this.worker.on('error', () => this.fail('unavailable', 'worker_error'));
    this.worker.on('exit', () => {
      if (!this.closing || this.pending.size) this.fail('unavailable', 'worker_exit');
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.send({ kind: 'close' })
      .then(() => undefined)
      .finally(() => this.terminate());
    return this.closePromise;
  }

  /** Pending writes may have committed; replay original intent after reopening. */
  async abort(): Promise<void> {
    this.closing = true;
    this.fail('unavailable', 'abort');
    await this.terminate();
  }

  protected call(operation: Operation): Promise<Value> {
    if (this.closing) return Promise.reject(new StorageError('closed'));
    if (this.failed) return Promise.reject(new StorageError('unavailable'));
    if (this.pending.size >= this.limit) return Promise.reject(new StorageError('queue_full'));
    if (largeOperation(operation) && [...this.pending.values()].filter((value) => value.large).length >= 2)
      return Promise.reject(new StorageError('queue_full'));
    try {
      return this.send(checkedOperation(operation, this.runtimeTtlMs));
    } catch {
      return Promise.reject(new StorageError('invalid_input'));
    }
  }

  private send(operation: Operation): Promise<Value> {
    if (this.failed) return Promise.reject(new StorageError('unavailable'));
    if (!Number.isSafeInteger(this.nextId) || this.nextId < 0 || this.nextId >= Number.MAX_SAFE_INTEGER) {
      this.fail('unavailable');
      return Promise.reject(new StorageError('unavailable'));
    }
    const messageId = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(messageId, {
        resolve,
        reject,
        operation: operation.kind,
        large: largeOperation(operation),
        replyLimit: operationReplyLimit(operation),
        ...(localSessionOperation(operation) ? { localSession: operation } : {}),
        ...(deletionOperation(operation) ? { deletion: operation } : {}),
        ...(absenceOperation(operation) ? { absence: operation } : {}),
        ...(finalizationOperation(operation) ? { finalization: operation } : {}),
        ...(outputOperation(operation) ? { output: operation } : {}),
        ...(eventOperation(operation) ? { event: operation } : {}),
        ...(dispatchOperation(operation) ? { dispatch: operation } : {}),

        ...(operation.kind === 'cancelRun' ? { cancellation: operation.command } : {}),
      });
      const pending = this.pending.get(messageId)!;
      this.bindReadRequest(pending, operation);
      this.watchProgress(false);
      try {
        this.worker.postMessage({ ...operation, messageId });
      } catch {
        this.fail('unavailable', 'post_failed');
      }
    });
  }

  private receive(input: unknown): void {
    if (this.failed) return;
    let reply: WorkerReply;
    try {
      reply = captureWorkerReply(input);
    } catch {
      this.fail('unavailable');
      return;
    }
    if (reply.kind === 'ready') {
      this.readyResolve();
      return;
    }
    if (reply.kind === 'startup_error') {
      this.fail(reply.code);
      return;
    }
    const pending = this.pending.get(reply.messageId);
    if (!pending) {
      this.fail('unavailable');
      return;
    }
    if (reply.ok) this.resolve(reply, pending);
    else {
      if (reply.code === 'unavailable') {
        this.fail('unavailable');
        return;
      }
      this.release(reply.messageId);
      pending.reject(new StorageError(reply.code));
    }
  }

  private resolve(reply: Extract<WorkerReply, { kind: 'result'; ok: true }>, pending: Pending): void {
    let value: Value;
    try {
      value = pending.history
        ? captureHistoryReply(pending.history, reply.value)
        : (this.readDeletionReply(pending, reply.value) ??
          (pending.absence
            ? captureAbsenceReply(pending.absence, reply.value)
            : pending.finalization
              ? captureFinalizationReply(pending.finalization, reply.value)
              : pending.output
                ? captureOutputReply(pending.output, reply.value)
                : pending.event
                  ? captureEventReply(pending.event, reply.value)
                  : pending.dispatch
                    ? captureDispatchReply(pending.dispatch, reply.value)
                    : pending.cancellation
                      ? captureCancelRunReply(reply.value, pending.cancellation)
                      : (boundedCopy(reply.value, pending.replyLimit) as Value)));
    } catch {
      this.fail('unavailable');
      return;
    }
    this.release(reply.messageId);
    pending.resolve(value);
  }

  private bindReadRequest(pending: Pending, operation: Operation): void {
    if (operation.kind === 'deleteNamespace') pending.namespaceDeletion = operation;
    if (retentionOperation(operation)) pending.retention = operation;
    if (settlementOperation(operation)) pending.settlement = operation;
    if (historyOperation(operation)) pending.history = operation;
    if (exportOperation(operation)) pending.exportJob = operation;
    if (operation.kind === 'getRunExecution') pending.execution = operation.key;
    if (artifactReadOperation(operation)) pending.artifacts = operation;
    if (operation.kind === 'getRunEvents') pending.runEvents = operation.query;
    if (operation.kind === 'getRunResult') pending.result = operation.key;
  }

  private readDeletionReply(pending: Pending, value: unknown): Value | undefined {
    if (pending.namespaceDeletion) return captureNamespaceDeletionReply(pending.namespaceDeletion.command, value);
    return this.readReply(pending, value);
  }

  private readReply(pending: Pending, value: unknown): Value | undefined {
    if (pending.retention) return captureRetentionReply(pending.retention, value);
    if (pending.settlement) return captureSettlementValue(pending.settlement, value);
    if (pending.exportJob) return captureExportReply(pending.exportJob, value);
    if (pending.localSession) return captureLocalSessionReply(pending.localSession, value);
    if (pending.deletion) return captureDeletionReply(pending.deletion, value);
    if (pending.execution) return captureExecutionReply(pending.execution, value);
    if (pending.artifacts) return captureArtifactReadReply(pending.artifacts, value);
    if (pending.runEvents) return captureRunEventsReply(pending.runEvents, value);
    if (pending.result) return captureResultReply(pending.result, value);
    return undefined;
  }

  private release(messageId: number): void {
    this.pending.delete(messageId);
    this.watchProgress();
  }

  /** Serial worker: every completion resets the bounded no-progress deadline. */
  private watchProgress(reset = true): void {
    if (!reset && this.progressTimer) return;
    clearTimeout(this.progressTimer);
    this.progressTimer = this.pending.size
      ? setTimeout(() => this.fail('unavailable', 'progress_timeout'), 5000)
      : undefined;
  }

  protected fail(code: ErrorCode, reason = 'storage_failure'): void {
    if (this.failed) return;
    clearTimeout(this.progressTimer);
    this.failed = true;
    reportWorkerFailure({
      reason,
      code,
      pending: this.pending.size,
      operation: this.pending.values().next().value?.operation ?? null,
    });
    this.readyReject(new StorageError(code));
    for (const pending of this.pending.values()) {
      pending.reject(new StorageError(code));
    }
    void this.terminate().catch(() => {});
    if (reason !== 'abort') notifyWorkerFailure(this.onFailure, new StorageError(code));
  }

  protected terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate().then((code) => {
      this.pending.clear();
      return code;
    });
    return this.terminationPromise;
  }
}
