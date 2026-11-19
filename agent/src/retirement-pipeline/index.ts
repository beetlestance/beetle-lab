import { cleanupAccess, CleanupAccessError } from '../cleanup-access/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest, outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementReply } from '@beetle/contracts/output-retirement';
import { captureWindow } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import { retirementDigest } from '../retirement-values/index.js';
import { executePipeline } from './execute.js';
import { executeReconciliation } from './reconcile.js';
import { RetirementPipelineError } from './types.js';
import type {
  RetirementPipelineOptions,
  PipelineNativePorts,
  PipelineWork,
  PipelineEntry,
  ReconcileWork,
} from './types.js';
export { RetirementPipelineError } from './types.js';
export type { RetirementPipelineOptions, PipelineNativePorts, PipelineWork, ReconcileWork } from './types.js';
const owners = new WeakMap<object, RetirementPipeline>();
function rejected<T = RetirementReply>(error: unknown): { result: Promise<T>; settled: Promise<void> } {
  const result = Promise.reject<T>(error);
  void result.catch(() => undefined);
  const settled = Promise.reject<void>(error);
  void settled.catch(() => undefined);
  return { result, settled };
}
/** Same scope and digest share the original tick; reconciliation never shares or is shared. */
function shared(existing: PipelineEntry, entry: PipelineEntry, coalesce: boolean): PipelineWork {
  if (existing.digest !== entry.digest) throw new RetirementPipelineError('conflict');
  if (!coalesce || existing.reconciling || !existing.work) throw new RetirementPipelineError('capacity');
  return existing.work;
}
/** Bounded process-local composition; no endpoint, background queue or refund authority. */
export class RetirementPipeline {
  private readonly entries = new Set<PipelineEntry>();
  private readonly scopes = new Map<string, PipelineEntry>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly options: RetirementPipelineOptions;
  constructor(options: RetirementPipelineOptions) {
    const steps = options.maximumSteps ?? 16;
    if (!Number.isSafeInteger(steps) || steps < 1 || steps > 16) throw new RetirementPipelineError('invalid_input');
    if (owners.has(options.journal.retirements)) throw new RetirementPipelineError('capacity');
    this.options = Object.freeze({ ...options, maximumSteps: steps });
    owners.set(options.journal.retirements, this);
  }
  tick(input: unknown, operation: Operation): PipelineWork {
    return this.tickWithPorts(input, operation);
  }
  /** Trusted private native fault seam; never exposed by Root's public process port. */
  tickWithPorts(input: unknown, raw: Operation, ports?: PipelineNativePorts): PipelineWork {
    const admitted = this.admit(input, raw, true);
    if (!admitted.ok) return rejected(admitted.error);
    if (admitted.existing) return admitted.existing;
    return this.track(admitted.entry, () =>
      executePipeline({
        options: this.options,
        request: admitted.request,
        operation: admitted.operation,
        entry: admitted.entry,
        closed: () => this.closed,
        ...(ports ? { ports } : {}),
      }),
    );
  }
  /**
   * Operator reconciliation of a prepared task whose folder facts went stale (decision 030): the
   * stored retirement request is replayed through producer and runtime retirement, so the original
   * runtime is proven absent, then the folders are observed and the result recorded in the Journal.
   * Never coalesces with a cleanup tick and never plans, removes or receipts anything.
   */
  reconcileWithPorts(input: unknown, raw: Operation, ports?: PipelineNativePorts): ReconcileWork {
    const admitted = this.admit(input, raw, false);
    if (!admitted.ok) return rejected(admitted.error);
    if (admitted.existing) return rejected(new RetirementPipelineError('capacity'));
    return this.track(admitted.entry, () =>
      executeReconciliation({
        options: this.options,
        request: admitted.request,
        operation: admitted.operation,
        entry: admitted.entry,
        closed: () => this.closed,
        ...(ports ? { ports } : {}),
      }),
    );
  }
  private admit(
    input: unknown,
    raw: Operation,
    coalesce: boolean,
  ):
    | { ok: false; error: unknown }
    | { ok: true; existing: PipelineWork; entry?: undefined }
    | {
        ok: true;
        existing?: undefined;
        entry: PipelineEntry;
        request: ReturnType<typeof captureOutputRetirementRequest>;
        operation: Operation;
      } {
    if (this.closed) return { ok: false, error: new RetirementPipelineError('closed') };
    if (this.entries.size >= 2) return { ok: false, error: new RetirementPipelineError('capacity') };
    const entry: PipelineEntry = { uncertain: false };
    this.entries.add(entry);
    try {
      const operation = captureWindow(raw);
      const request = captureOutputRetirementRequest(input);
      const { organizationId, workspaceId, attemptId, generation } = request;
      const key = { organizationId, workspaceId, attemptId, generation };
      cleanupAccess(this.options.journal.retirements).assertOpen(key);
      entry.id = encodeCanonicalJson(key, 640);
      entry.digest = outputRetirementDigest(request, retirementDigest);
      const existing = this.scopes.get(entry.id);
      if (existing) {
        this.entries.delete(entry);
        return { ok: true, existing: shared(existing, entry, coalesce) };
      }
      entry.access = cleanupAccess(this.options.journal.retirements).acquire(key);
      entry.reconciling = !coalesce;
      this.scopes.set(entry.id, entry);
      return { ok: true, entry, request, operation };
    } catch (error) {
      this.entries.delete(entry);
      return {
        ok: false,
        error:
          error instanceof RetirementPipelineError
            ? error
            : new RetirementPipelineError(error instanceof CleanupAccessError ? 'capacity' : 'invalid_input'),
      };
    }
  }
  private track<T>(entry: PipelineEntry, execute: () => Promise<T>) {
    const result = Promise.resolve().then(execute);
    const settled = result.then(() => undefined);
    void settled.catch(() => undefined);
    const work = Object.freeze({ result, settled });
    entry.settled = settled;
    if (!entry.reconciling) entry.work = work as unknown as PipelineWork;
    void result.then(
      () => this.release(entry),
      () => {
        if (!entry.uncertain) this.release(entry);
      },
    );
    return work;
  }
  private release(entry: PipelineEntry): void {
    entry.access?.release();
    this.entries.delete(entry);
    if (entry.id && this.scopes.get(entry.id) === entry) this.scopes.delete(entry.id);
  }
  status() {
    return Object.freeze({ retained: this.entries.size, closed: this.closed });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.options.noTask?.stop();
    this.closing = Promise.resolve().then(async () => {
      await Promise.allSettled([...this.entries].map((entry) => entry.settled));
      if (this.entries.size) throw new RetirementPipelineError('unavailable');
    });
    return this.closing;
  }
}
