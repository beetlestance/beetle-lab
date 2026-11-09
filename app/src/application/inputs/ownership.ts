import { InputByteError } from '../../ports/input-bytes.js';
import type { InputByteJob, InputByteContext } from '../../ports/input-bytes.js';
import type { InputKey } from '../../ports/inputs.js';

export class Owner {
  readonly controller = new AbortController();
  readonly done: Promise<void>;
  private release!: () => void;
  private readonly originals = new Set<Promise<unknown>>();
  private readonly jobs = new Set<InputByteJob<unknown>>();
  private finished = false;
  private quarantined = false;
  private readonly detach: () => void;
  constructor(signal: AbortSignal | undefined, private readonly fence: () => void, private readonly retire: () => void) {
    this.done = new Promise(resolve => { this.release = resolve; });
    const abort = () => this.controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.detach = () => signal?.removeEventListener('abort', abort);
  }
  check(): void { if (this.controller.signal.aborted) throw new InputByteError('cancelled'); }
  context(reserve: number): InputByteContext { this.check(); return { signal: this.controller.signal, freeSpaceReserveBytes: reserve }; }
  track<T>(original: Promise<T>): Promise<T> {
    this.originals.add(original);
    void original.then(() => this.completed(original), () => this.completed(original));
    return original;
  }
  async job<T>(job: InputByteJob<T>): Promise<T> {
    this.jobs.add(job);
    const custody = job.settled.then(() => { this.jobs.delete(job); }, () => {
      this.quarantine(); return new Promise<void>(() => {});
    });
    this.track(custody);
    try { return await this.track(job.result); }
    catch (error) { if (error instanceof InputByteError && error.code === 'cleanup') this.quarantine(); throw error; }
  }
  async drainCustody(): Promise<void> {
    while (this.originals.size) await Promise.allSettled([...this.originals]);
    if (this.quarantined) await new Promise<void>(() => {});
  }
  finish(): void { this.finished = true; this.detach(); this.maybeRetire(); }
  private quarantine(): void { this.quarantined = true; this.fence(); }
  private completed(original: Promise<unknown>): void { this.originals.delete(original); this.maybeRetire(); }
  private maybeRetire(): void {
    if (!this.finished || this.quarantined || this.originals.size) return;
    this.retire(); this.release();
  }
}
export class Ownership {
  private closed = false;
  private readonly owners = new Map<string, Owner>();
  private readonly calls = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;
  check(): void { if (this.closed) throw new InputByteError('closed'); }
  acquire(key: InputKey, signal: AbortSignal | undefined): Owner {
    this.check();
    const id = `${key.scope.organizationId}/${key.scope.workspaceId}/${key.id}`;
    if (this.owners.has(id) || this.owners.size >= 2) throw new InputByteError('busy');
    const owner = new Owner(signal, () => { this.closed = true; }, () => { this.owners.delete(id); });
    this.owners.set(id, owner); return owner;
  }
  call<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    this.calls.add(result);
    void result.then(() => { this.calls.delete(result); }, () => { this.calls.delete(result); });
    try { void Promise.resolve(work()).then(resolve, reject); }
    catch (error) { reject(error); }
    return result;
  }
  close(): Promise<void> {
    this.closed = true;
    if (!this.closing) {
      for (const owner of this.owners.values()) owner.controller.abort();
      this.closing = Promise.allSettled([...this.calls, ...[...this.owners.values()].map(owner => owner.done)]).then(() => undefined);
    }
    return this.closing;
  }
}
