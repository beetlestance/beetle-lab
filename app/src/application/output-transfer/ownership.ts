import type { OutputFileContext, OutputFileJob } from '../../ports/output-bytes.js';
import { fail, safeError, requireTransfer } from './errors.js';
import { OutputTransferError } from '../../ports/output-transfer.js';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
export function checkSignal(signal: AbortSignal | undefined): void {
  if (signal === undefined) return;
  try { Reflect.apply(aborted, signal, []); } catch { fail('invalid_input'); }
}

/** Retains original promises separately from the cancellable caller result. */
export class TransferOwner {
  readonly controller = new AbortController();
  readonly settled: Promise<void>;
  private release!: () => void;
  private readonly originals = new Set<Promise<unknown>>();
  private readonly files = new Set<OutputFileJob<unknown>>();
  private finished = false;
  private broken = false;
  private detach = () => {};
  private readonly stopped: Promise<never>;
  constructor(private readonly lifecycle: { retire(): void; quarantine(): void }) {
    this.settled = new Promise(resolve => { this.release = resolve; });
    this.stopped = new Promise((_, reject) => {
      this.controller.signal.addEventListener('abort', () => { reject(new OutputTransferError('cancelled')); }, {once: true});
    });
    void this.stopped.catch(() => {});
  }
  attach(signal: AbortSignal | undefined): void {
    checkSignal(signal);
    if (!signal) return;
    const abort = () => this.controller.abort();
    AbortSignal.prototype.addEventListener.call(signal, 'abort', abort, {once: true});
    this.detach = () => AbortSignal.prototype.removeEventListener.call(signal, 'abort', abort);
    if (Reflect.apply(aborted, signal, [])) abort();
  }
  check(): void { if (this.controller.signal.aborted) fail('cancelled'); }
  track<T>(original: Promise<T>): Promise<T> {
    this.originals.add(original);
    void original.then(() => this.complete(original), () => this.complete(original));
    return original;
  }
  async call<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    const original = this.track(Promise.resolve(work()));
    return Promise.race([original, this.stopped]);
  }
  async file<T>(work: () => OutputFileJob<T>): Promise<T> {
    this.check();
    const job = work();
    this.files.add(job);
    const result = this.track(Promise.resolve(job.result));
    const custody = this.track(Promise.resolve(job.settled).catch(() => {
      this.quarantine(); return new Promise<void>(() => {});
    }));
    void Promise.allSettled([result, custody]).then(() => { if (!this.broken) this.files.delete(job); });
    void result.catch(error => { if (safeError(error).code === 'cleanup') this.quarantine(); });
    try {
      const value = await Promise.race([result, this.stopped]);
      await Promise.race([custody, this.stopped]);
      this.check(); return value;
    } catch (error) { if (this.broken) fail('cleanup'); throw error; }
  }
  context(reserve: number, clock: () => number): OutputFileContext {
    this.check(); const now = clock(); const deadline = Math.floor(now) + 300_000;
    requireTransfer(Number.isFinite(deadline) && deadline > now && deadline - now <= 300_000, 'invalid_input');
    this.check(); return {signal: this.controller.signal, deadline, freeSpaceReserveBytes: reserve};
  }
  finish(): void {
    this.finished = true;
    if (this.originals.size) this.controller.abort();
    this.detach(); this.retire();
  }
  private quarantine(): void {
    if (this.broken) return;
    this.broken = true; this.lifecycle.quarantine();
  }
  private complete(original: Promise<unknown>): void { this.originals.delete(original); this.retire(); }
  private retire(): void {
    if (!this.finished || this.broken || this.originals.size) return;
    this.lifecycle.retire(); this.release();
  }
}
