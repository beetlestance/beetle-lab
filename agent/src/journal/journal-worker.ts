import { notifyWorkerFailure, reportWorkerFailure, captureFailureCode } from './failure-diagnostic.js';

import { Worker } from 'node:worker_threads';

import { DEFAULT_QUOTA_BYTES } from './event-input.js';

import type { ErrorCode, Operation, Reply, Value } from './protocol.js';
import { JournalError } from './options.js';
import type { JournalOptions } from './options.js';
interface Pending {
  resolve(value: Value): void;
  reject(error: JournalError): void;
  operation: Operation['kind'];
  large: boolean;
}
function largeOperation(operation: Operation): boolean {
  return (
    [
      'cleanupReceiptRead',
      'cleanupReceiptCommit',
      'cleanupProgressRead',
      'cleanupProgressBegin',
      'cleanupProgressAdvance',
      'cleanupPlanRead',
      'cleanupPlanStore',
      'outputCollectionBegin',
      'outputCollectionRead',
      'outputSourceCommit',
      'outputSourceRead',
      'outputSourceRelease',
      'outputCollectionFailed',
      'outputDeliveryClose',
      'outputDeliveryRead',
      'outputDeliveryHistoryRead',
      'outputAbsenceClose',
      'outputAbsenceRead',
      'outputStoppedHistoryRead',
    ].includes(operation.kind) ||
    operation.kind === 'offer' ||
    operation.kind === 'cancelOriginal' ||
    operation.kind === 'read' ||
    operation.kind === 'readExportAssignment' ||
    (operation.kind === 'admission' && operation.request.kind === 'offer')
  );
}
export abstract class JournalWorker {
  private readonly worker: Worker;

  private readonly pending = new Map<number, Pending>();

  private readonly limit: number;

  private progressTimer: NodeJS.Timeout | undefined;

  private nextId = 0;

  private largePending = 0;

  private closing = false;

  protected failed = false;

  private readonly onFailure: ((error: JournalError) => void) | undefined;

  storageStatus(): 'ready' | 'closing' | 'unavailable' {
    return this.failed ? 'unavailable' : this.closing ? 'closing' : 'ready';
  }

  private closePromise: Promise<void> | undefined;

  private terminationPromise: Promise<number> | undefined;

  private readyResolve: () => void = () => undefined;

  private readyReject: (error: JournalError) => void = () => undefined;

  protected readonly ready: Promise<void>;

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    // Worker FIFO drains previously posted commands; close uses one reserved slot.
    this.closePromise = this.send({ kind: 'close' })
      .then(() => undefined)
      .finally(() => this.terminate());
    return this.closePromise;
  }

  /** Immediate shutdown: pending writes have unknown commit outcome. */
  async abort(): Promise<void> {
    this.closing = true;
    this.fail('unavailable', 'abort');
    await this.terminate();
  }

  private refusal(): ErrorCode | null {
    if (this.closing) return 'closed';
    if (this.failed) return 'unavailable';
    return this.pending.size >= this.limit ? 'queue_full' : null;
  }

  protected output<T>(prepare: () => Operation, validate: (value: Value) => T): Promise<T> {
    return this.prepare(prepare, true).then((value) => {
      try {
        return validate(value);
      } catch {
        this.fail('unavailable');
        throw new JournalError('unavailable');
      }
    });
  }

  protected prepare(operation: () => Operation, large: boolean | (() => boolean) = false): Promise<Value> {
    const refusal = this.refusal();
    if (refusal) return Promise.reject(new JournalError(refusal));
    let reserved = false;
    let prepared: Operation;
    try {
      const holdsLarge = typeof large === 'function' ? large() : large;
      if (holdsLarge && this.largePending >= 2) return Promise.reject(new JournalError('queue_full'));
      if (holdsLarge) {
        this.largePending++;
        reserved = true;
      }
      prepared = operation();
    } catch {
      return Promise.reject(new JournalError('invalid_input'));
    } finally {
      if (reserved) this.largePending--;
    }
    return this.send(prepared);
  }
  protected constructor(options: JournalOptions) {
    this.onFailure = options.onFailure?.bind(options);
    this.limit = options.queueLimit ?? 32;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker = new Worker(options.workerUrl ?? new URL('./worker.js', import.meta.url), {
      workerData: { path: options.path, spoolQuotaBytes: options.spoolQuotaBytes ?? DEFAULT_QUOTA_BYTES },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker.on('message', (reply: Reply) => this.receive(reply));
    this.worker.on('error', () => this.fail('unavailable', 'worker_error'));
    this.worker.on('exit', () => {
      if (!this.closing || this.pending.size) this.fail('unavailable', 'worker_exit');
    });
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
      this.pending.set(id, { resolve, reject, operation: operation.kind, large });
      this.watchProgress(false);
      try {
        this.worker.postMessage({ ...operation, id });
      } catch {
        this.fail('unavailable', 'post_failed');
      }
    });
  }

  private receive(reply: Reply): void {
    if (this.failed) return;
    if (reply.kind === 'ready') {
      this.readyResolve();
      return;
    }
    if (reply.kind === 'startup_error') {
      this.fail(reply.code);
      return;
    }
    const pending = this.pending.get(reply.id);
    if (!pending) {
      this.fail('unavailable');
      return;
    }
    if (!reply.ok && reply.code === 'unavailable') {
      this.fail('unavailable');
      return;
    }
    this.pending.delete(reply.id);
    this.watchProgress();
    if (pending.large) this.largePending--;
    if (reply.ok) pending.resolve(reply.value);
    else {
      pending.reject(new JournalError(reply.code, reply.recovery));
    }
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
    code = captureFailureCode(code);
    reportWorkerFailure({
      reason,
      code,
      pending: this.pending.size,
      operation: this.pending.values().next().value?.operation ?? null,
    });
    this.readyReject(new JournalError(code));
    for (const pending of this.pending.values()) {
      pending.reject(new JournalError(code));
    }
    this.pending.clear();
    void this.terminate().catch(() => {});
    if (reason !== 'abort') notifyWorkerFailure(this.onFailure, new JournalError(code));
  }

  protected terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate();
    return this.terminationPromise;
  }
}
