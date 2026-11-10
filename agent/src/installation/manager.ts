import type { AttemptSnapshot } from '@beetle/contracts';
import type { Scope } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { StopReason } from '../journal/index.js';
import type { TimeoutReason } from '../timeout/index.js';
import { allocation, recover } from './recovery.js';
import { performance } from 'node:perf_hooks';
import { reconcileAbsence } from './absence.js';
import { closedSourceCandidate, releaseProvisional } from './ownership.js';
import { budgetCopy, checkBudget } from './budget.js';
import { createEntry, identity, scopeCopy } from './entry.js';
import type { Entry } from './entry.js';
import { drive } from './drive.js';
import type { DriveContext } from './drive.js';
import { acquireLease } from './leases.js';
import type { EntryLease } from './leases.js';
import { closeWatches, retireNative } from './retirement.js';
import { readClosedDelivery, reconcileDelivery, releaseStoredSource, rememberSource } from './delivery.js';
import { enqueue } from './enqueue.js';
import { structuralOffer } from './offer.js';
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
    if (_entry.retiring) throw new InstallationError('busy');
  }
  acquireStage(): boolean { if (this.stages >= 2) return false; this.stages++; return true; }
  releaseStage(): void { this.stages--; }
  private entry(key: Readonly<Scope>): Entry {
    const id = identity(key); const existing = this.entries.get(id);
    if (existing) return existing;
    if (this.entries.size >= 64) throw new InstallationError('capacity');
    const entry = createEntry(key); this.entries.set(id, entry); return entry;
  }
  private async releaseLease(entry: Entry, lease: EntryLease): Promise<void> {
    entry.users--;
    lease.finish();
    await releaseProvisional({ journal: this.options.journal, entries: this.entries, entry,
      retire: () => this.retire(entry) });
    await this.releaseClosedSource(entry);
  }
  private async releaseClosedSource(entry: Entry): Promise<void> {
    const key = identity(entry.key);
    if (this.entries.get(key) !== entry || !closedSourceCandidate(entry)) return;
    // Fence synchronously after the last public lease, before the first Journal await.
    await retireNative(entry);
    if (await readClosedDelivery(this.options.journal, entry)) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    }
  }
  private driveContext(caller: EntryLease, budget: Operation): DriveContext {
    return { options: this.options, now: () => this.now(), guard: (entry, budget) => this.guard(entry, budget),
      acquireStage: () => this.acquireStage(), releaseStage: () => this.releaseStage(),
      retire: (entry, progress) => this.retire(entry, caller, progress, budget),
      stopGuard: entry => this.stopGuard(entry), stopTimeout: (entry, reason) => this.stopTimeout(entry, reason) };
  }
  private async sourceCommitted(entry: Entry): Promise<boolean> {
    if (entry.sourceReceipt) return true;
    entry.sourceCheck = true;
    const source = await this.options.journal.readOutputSource(entry.key);
    if (source) { rememberSource(entry, source); return true; }
    entry.sourceCheck = false; return false;
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
  cancelOriginal(input: unknown): Promise<AttemptSnapshot> {
    return this.run(async () => {
      const offer = structuralOffer(input);
      const key = scopeCopy({ organizationId: offer.organizationId, workspaceId: offer.workspaceId,
        attemptId: offer.attemptId, generation: 1 });
      this.open(); const entry = this.entry(key);
      const lease = acquireLease(entry);
      try {
        const snapshot = await this.options.journal.cancelOriginal({ offer, now: this.now() });
        entry.cancelled = true;
        if (!await this.sourceCommitted(entry)) this.signal(entry);
        return snapshot;
      } finally {
        await this.releaseLease(entry, lease);
      }
    });
  }
  drive(input: Scope, operation: Operation): Promise<DriveProgress> {
    return this.run(async () => {
      const key = scopeCopy(input); this.open(); const entry = this.entry(key);
      if (entry.active) throw new InstallationError('busy');
      const lease = acquireLease(entry, true);
      // Reserve the lane before reading the caller's budget descriptors.
      let resolve!: (value: DriveProgress) => void; let reject!: (error: unknown) => void;
      const active = new Promise<DriveProgress>((yes, no) => { resolve = yes; reject = no; });
      entry.active = active;
      try {
        const budget = budgetCopy(operation);
        void Promise.resolve().then(async () => {
          this.open();
          if (entry.retiring || entry.sourceReceipt) {
            const progress = entry.retirementProgress ?? (entry.sourceReceipt ? { kind: 'released' as const, collection: 'finished' as const } : null);
            if (!progress) throw new InstallationError('cleanup');
            await this.retire(entry, lease, progress, budget); return progress;
          }
          return drive(this.driveContext(lease, budget), entry, budget);
        }).then(resolve, reject);
      } catch (error) { reject(error); }
      try { return await active; } finally {
        delete entry.active;
        await this.releaseLease(entry, lease);
      }
    });
  }
  private signal(entry: Entry, reason: StopReason = 'cancelled'): Promise<void> {
    entry.cancelled = true; entry.abort.abort();
    if (entry.fresh && !entry.controller) this.closeWatch(entry);
    if (!entry.controller) return Promise.resolve();
    const urgent = ['output_limit', 'artifact_incomplete', 'clock_integrity'].includes(reason);
    if (entry.cancellation && (!urgent || entry.urgentStop)) return entry.cancellation;
    entry.urgentStop ||= urgent;
    const previous = entry.cancellation;
    const operation = entry.controller.cancel(reason);
    entry.cancellation = Promise.allSettled([previous, operation]).then(outcomes => {
      if (outcomes.some(value => value.status === 'rejected')) throw new InstallationError('cleanup');
    });
    // Handle rejection immediately while retaining the original for shutdown.
    void entry.cancellation.catch(() => { entry.cleanupFailed = true; });
    return entry.cancellation;
  }
  cancel(input: Scope): Promise<AttemptSnapshot> {
    return this.requestStop(input, 'cancelled');
  }
  stop(input: Scope, reason: 'output_limit' | 'artifact_incomplete' | TimeoutReason): Promise<AttemptSnapshot> {
    if (!['output_limit', 'artifact_incomplete', 'timeout', 'clock_integrity'].includes(reason)) return Promise.reject(new InstallationError('invalid_input'));
    return this.requestStop(input, reason);
  }
  private requestStop(input: Scope, reason: StopReason): Promise<AttemptSnapshot> {
    return this.run(async () => {
      const key = scopeCopy(input); this.open(); const entry = this.entry(key);
      const lease = acquireLease(entry);
      try {
        await this.requestIntent(entry, reason);
        return await this.options.journal.get(key);
      } finally {
        await this.releaseLease(entry, lease);
      }
    });
  }
  stopGuard(entry: Entry): Promise<void> { return this.requestIntent(entry, 'artifact_incomplete'); }
  stopTimeout(entry: Entry, reason: TimeoutReason | 'artifact_incomplete'): Promise<void> { return this.requestIntent(entry, reason); }
  private async requestIntent(entry: Entry, reason: StopReason): Promise<void> {
    entry.cancelled = true;
    const now = reason === 'clock_integrity' ? 0 : this.now(); this.open();
    await this.options.journal.supervision({ key: entry.key, now, cancel: true, reason });
    if (!await this.sourceCommitted(entry)) this.signal(entry, reason);
  }
  private closeWatch(entry: Entry): void {
    closeWatches(entry);
  }
  inspect(input: Scope): Promise<InstallationAttempt> {
    return this.run(async () => {
      const key = scopeCopy(input); this.open();
      const snapshot = await this.options.journal.get(key);
      return { snapshot, allocation: await allocation(this.options.journal, key) };
    });
  }
  async retire(entry: Entry, caller?: EntryLease, progress?: DriveProgress, operation?: Operation): Promise<void> {
    if (progress) entry.retirementProgress ??= progress;
    await retireNative(entry, caller);
    if (await releaseStoredSource(this.options.journal, entry)) {
      await reconcileDelivery(this.options.journal, entry);
      this.entries.delete(identity(entry.key));
    } else {
      const closed = await reconcileAbsence(this.options.journal, entry, () => this.retireReleased(entry, operation));
      if (closed || !await allocation(this.options.journal, entry.key)) this.entries.delete(identity(entry.key));
    }
  }
  private async retireReleased(entry: Entry, operation?: Operation): Promise<void> {
    const { journal, catalog, supervisor } = this.options;
    const current = await allocation(journal, entry.key);
    if (current?.status !== 'released') throw new InstallationError('cleanup');
    const plan = recover(catalog, await journal.readOffer(entry.key), current);
    await supervisor.retireReleased({ key: entry.key, plan }, operation ?? { deadline: performance.now() + 30_000 });
  }
  private async drain(entry: Entry): Promise<void> {
    await retireNative(entry);
    if (!entry.controller && !entry.sourceReceipt) await this.releaseUnstarted(entry);
    await this.retire(entry);
  }
  private async releaseUnstarted(entry: Entry): Promise<void> {
    if (entry.retirementProgress?.kind === 'rejected') return;
    const current = await allocation(this.options.journal, entry.key);
    if (current?.status === 'charged') {
      if (current.createToken) throw new InstallationError('cleanup');
      // Only a successful original admission proves this lifetime owns the charge.
      if (entry.fresh) await this.options.journal.admission({ kind: 'abortUnstarted', key: entry.key });
    }
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
        entry.retiring = true; entry.cancelled = true; entry.abort.abort();
        this.closeWatch(entry);
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
