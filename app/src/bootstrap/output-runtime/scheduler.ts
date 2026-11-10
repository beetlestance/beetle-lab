import { getRun } from '../../application/runs/index.js';
import { createEventDiscovery } from '../../adapters/outbound/runner/index.js';
import type { EventBinding } from '../../ports/events.js';
import type { OutputByteStore } from '../../ports/output-bytes.js';
import type { OutputRuntime, OutputRuntimeOptions, OutputRuntimeState } from '../../ports/output-runtime.js';
import { OutputTransferError } from '../../ports/output-transfer.js';
import type { OutputTransfers, OutputTransferOutcome } from '../../ports/output-transfer.js';
import { finalizationValue, requireValue, sameBinding, transferValue } from './validation.js';

/** Private composition seam: production always supplies the real transfer/files owners. */
export class OutputScheduler implements OutputRuntime {
  private readonly discover: ReturnType<typeof createEventDiscovery>;
  private readonly active = new Map<EventBinding, {abort: AbortController; original: Promise<void>}>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scanner: Promise<void> | undefined;
  private closing?: Promise<void>;
  private transferClose?: Promise<void>;
  private notification?: Promise<void>;
  private stopped = false;
  private failed = false;
  private closed = false;
  private failure?: {error: unknown};
  private problem: OutputRuntimeState['problem'] = null;
  constructor(private readonly options: OutputRuntimeOptions, private readonly transfers: OutputTransfers,
    private readonly files: Pick<OutputByteStore, 'close'>) {
    this.discover = createEventDiscovery(options.outputs.scan);
  }
  start(): void { this.turn(); }
  state(): OutputRuntimeState {
    return Object.freeze({status: this.closed ? 'closed' : this.failed ? 'failed' : 'running',
      active: this.active.size, problem: this.problem});
  }
  private fence(): void {
    this.stopped = true; clearTimeout(this.timer); this.timer = undefined;
    for (const owner of this.active.values()) owner.abort.abort();
    this.transferClose ??= this.transfers.close();
    void this.transferClose.catch(error => this.fail(error));
  }
  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true; this.failure = {error}; this.problem = 'operation_failure'; this.fence();
    this.notification = Promise.resolve().then(() => this.options.onFailure(error)).catch(notification => {
      this.problem = 'failure_notification';
      this.failure = {error: new AggregateError([error, notification], 'Output failure notification failed')};
    });
  }
  private turn(): void {
    if (this.stopped) return;
    this.timer = undefined;
    const scan = Promise.resolve().then(() => this.scan()).catch(error => this.fail(error)).finally(() => {
      this.scanner = undefined;
      if (!this.stopped) this.timer = setTimeout(() => this.turn(), this.options.intervalMs ?? 250);
    });
    this.scanner = scan;
  }
  private async scan(): Promise<void> {
    if (this.stopped || this.active.size >= 2) return;
    const candidate = await this.discover();
    if (this.stopped || !candidate) return;
    const binding = candidate.binding;
    if ([...this.active.keys()].some(value => sameBinding(value, binding))) return;
    const abort = new AbortController();
    const original = Promise.resolve().then(() => this.run(binding, abort.signal)).catch(error => this.fail(error))
      .finally(() => this.active.delete(binding));
    this.active.set(binding, {abort, original});
  }
  private transferFailure(error: unknown): void {
    if (error instanceof OutputTransferError) {
      if (error.code === 'busy' || (this.stopped && ['cancelled', 'closed'].includes(error.code))) return;
      if (error.code === 'transport' || error.code === 'source_unavailable') { this.problem = error.code; return; }
    }
    this.fail(error);
  }
  private async run(binding: EventBinding, signal: AbortSignal): Promise<void> {
    if (this.stopped) return;
    const job = this.transfers.transfer(binding, signal);
    let outcome: OutputTransferOutcome | undefined;
    const result = job.result.then(value => { outcome = transferValue(value, binding); }).catch(error => this.transferFailure(error));
    const settled = job.settled.catch(error => this.fail(error));
    await Promise.all([result, settled]);
    if (this.stopped || outcome?.kind !== 'published') return;
    const attempt = binding.key.attempt;
    const run = await getRun({id: binding.key.runId, scope: {kind: 'workspace',
      organizationId: attempt.organizationId, workspaceId: attempt.workspaceId}}, this.options.runs);
    requireValue(run.activeAttemptId === attempt.attemptId);
    if (this.stopped) return;
    const request = {binding, sourceDigest: outcome.sourceDigest, manifestDigest: outcome.manifestDigest, expectedRunVersion: run.version};
    try { finalizationValue(await this.options.finalizations.finalize(request), request, run); }
    catch (error) {
      if (error instanceof Error && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'conflict') return;
      throw error;
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.fence();
    this.closing = this.drain(); return this.closing;
  }
  private async drain(): Promise<void> {
    const originals = await Promise.allSettled([this.scanner, this.transferClose,
      ...[...this.active.values()].map(owner => owner.original)]);
    // Never release the lease before producer, scanner, Run and finalization originals retire.
    let nativeError: {error: unknown} | undefined;
    try { await this.files.close(); } catch (error) { nativeError = {error}; this.fail(error); }
    await this.notification;
    const rejected = originals.find(value => value.status === 'rejected');
    if (this.failure) throw this.failure.error;
    if (nativeError) throw nativeError.error;
    if (rejected?.status === 'rejected') throw rejected.reason;
  }
}
