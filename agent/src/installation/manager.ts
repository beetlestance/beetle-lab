import type { AttemptSnapshot } from '@beetle/contracts';
import type { Scope } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import { allocation } from './recovery.js';
import { releaseProvisional } from './ownership.js';
import { budgetCopy, checkBudget } from './budget.js';
import { createEntry, identity, scopeCopy } from './entry.js';
import type { Entry } from './entry.js';
import { drive } from './drive.js';
import { enqueue } from './enqueue.js';
import { InstallationError } from './types.js';
import type { DriveProgress, InstallationAttempt, InstallationController, InstallationOptions, OfferAcceptance } from './types.js';
const owners = new WeakMap<InstallationOptions['journal'], Manager>();
/** Installation lifetime, bounded operation custody and generation ownership. */
export class Manager implements InstallationController {
  readonly options: InstallationOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly work = new Set<Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | undefined;
  private stages = 0;
  private wallHigh = 0;
  constructor(options: InstallationOptions) {
    if (owners.has(options.journal)) throw new InstallationError('busy');
    this.options = Object.freeze({ ...options }); owners.set(options.journal, this);
  }
  now(): number {
    const now = (this.options.wallNow ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < this.wallHigh || now > 8_640_000_000_000_000) throw new InstallationError('clock');
    this.wallHigh = now; return now;
  }
  open(): void { if (this.closed) throw new InstallationError('closed'); }
  guard(_entry: Entry, budget: Operation): void {
    this.open(); checkBudget(budget);
  }
  acquireStage(): boolean { if (this.stages >= 2) return false; this.stages++; return true; }
  releaseStage(): void { this.stages--; }
  private entry(key: Readonly<Scope>): Entry {
    const id = identity(key); const existing = this.entries.get(id);
    if (existing) return existing;
    if (this.entries.size >= 64) throw new InstallationError('capacity');
    const entry = createEntry(key); this.entries.set(id, entry); return entry;
  }
  /** Reserve before touching caller objects, proxies, providers or clocks. */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new InstallationError('closed'));
    if (this.work.size >= 64) return Promise.reject(new InstallationError('busy'));
    let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    this.work.add(result);
    let original: Promise<T>;
    try { original = operation(); } catch (error) { original = Promise.reject(error); }
    void original.then(value => {
      this.work.delete(result); resolve(value);
    }, error => { this.work.delete(result); reject(error); });
    return result;
  }
  enqueue(input: unknown): Promise<OfferAcceptance> { return this.run(() => enqueue(this, input)); }
  drive(input: Scope, operation: Operation): Promise<DriveProgress> {
    return this.run(async () => {
      const key = scopeCopy(input); this.open(); const entry = this.entry(key);
      if (entry.active) throw new InstallationError('busy');
      entry.users++; entry.version++;
      // Reserve the lane before reading the caller's budget descriptors.
      let resolve!: (value: DriveProgress) => void; let reject!: (error: unknown) => void;
      const active = new Promise<DriveProgress>((yes, no) => { resolve = yes; reject = no; });
      entry.active = active;
      try {
        const budget = budgetCopy(operation);
        void Promise.resolve().then(() => drive(this, entry, budget)).then(resolve, reject);
      } catch (error) { reject(error); }
      try { return await active; } finally {
        delete entry.active; entry.users--;
        await releaseProvisional(this.options.journal, this.entries, entry);
      }
    });
  }
  private signal(entry: Entry): Promise<void> {
    entry.cancelled = true; entry.abort.abort();
    if (!entry.controller) return Promise.resolve();
    entry.cancellation ??= entry.controller.cancel();
    // Handle rejection immediately while retaining the original for shutdown.
    void entry.cancellation.catch(() => undefined);
    return entry.cancellation;
  }
  cancel(input: Scope): Promise<AttemptSnapshot> {
    return this.run(async () => {
      const key = scopeCopy(input); this.open(); const entry = this.entry(key);
      entry.users++; entry.version++;
      try {
        entry.cancelled = true; entry.abort.abort();
        const now = this.now(); this.open();
        await this.options.journal.supervision({ key, now, cancel: true });
        // Durable intent is observable while original runtime signalling drains.
        this.signal(entry);
        return await this.options.journal.get(key);
      } finally {
        entry.users--;
        await releaseProvisional(this.options.journal, this.entries, entry);
      }
    });
  }
  inspect(input: Scope): Promise<InstallationAttempt> {
    return this.run(async () => {
      const key = scopeCopy(input); this.open();
      const snapshot = await this.options.journal.get(key);
      return { snapshot, allocation: await allocation(this.options.journal, key) };
    });
  }
  async retire(entry: Entry): Promise<void> {
    if (entry.cleanupFailed) throw new InstallationError('cleanup');
    if (entry.controller) {
      entry.closing ??= entry.controller.close();
      try { await entry.closing; } catch { entry.cleanupFailed = true; throw new InstallationError('cleanup'); }
    }
    this.entries.delete(identity(entry.key));
  }
  private async drain(entry: Entry): Promise<void> {
    const outcomes = await Promise.allSettled([entry.preparation?.result, entry.preparation?.quiesced, entry.cancellation]);
    await entry.active?.catch(() => undefined);
    if (entry.cleanupFailed || outcomes.some(value => value.status === 'rejected')) throw new InstallationError('cleanup');
    if (entry.controller) { await this.retire(entry); return; }
    const current = await allocation(this.options.journal, entry.key);
    if (current?.status === 'charged') {
      if (current.createToken) throw new InstallationError('cleanup');
      await this.options.journal.admission({ kind: 'abortUnstarted', key: entry.key });
    }
    await this.retire(entry);
  }
  private async drainEntries(): Promise<boolean> {
    const entries = [...this.entries.values()]; let failed = false;
    for (let index = 0; index < entries.length; index += 2) {
      const outcomes = await Promise.allSettled(entries.slice(index, index + 2).map(entry => this.drain(entry)));
      if (outcomes.some(value => value.status === 'rejected')) failed = true;
    }
    return failed;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    // Assign cached shutdown before callbacks from AbortSignal listeners can reenter.
    this.closing = Promise.resolve().then(async () => {
      const entries = [...this.entries.values()];
      for (const entry of entries) {
        this.signal(entry);
        if (entry.controller) {
          entry.closing ??= entry.controller.close();
          void entry.closing.catch(() => { entry.cleanupFailed = true; });
        }
      }
      const work = await Promise.allSettled([...this.work]);
      const failed = await this.drainEntries();
      // A fenced caller failure is expected; cleanup failures remain sticky on their owner.
      void work;
      if (failed) throw new InstallationError('cleanup');
      owners.delete(this.options.journal);
    });
    return this.closing;
  }
}
