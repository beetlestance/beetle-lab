import { performance } from 'node:perf_hooks';
import { JournalError } from '../journal/index.js';
import type { StopReason } from '../journal/index.js';
import type { ReleaseEvidence, Reservation } from '../admission/index.js';
import { isRuntimePlan } from '../backends/docker/index.js';
import type { ControlReader, ControlReadValue } from '../collection/control/index.js';
import { CONTROL_READ_MAX_MS } from '../collection/control/index.js';
import { OUTPUT_COLLECTION_MAX_MS } from '../collection/output/index.js';
import type { OutputCollection, OutputRootIdentity } from '../collection/output/index.js';
import { copyControlScope } from '../control-protocol/index.js';
import type { LaunchActor, LaunchState } from '../supervisor/index.js';
import { collectionAuthority, collectionOptions, reportedResult } from './authority.js';
import type { CollectionAuthority } from './authority.js';
import { CollectionReadBusy, busyActor } from './launch-contention.js';
import { releaseEvidence } from './release.js';
import { SourceSession } from './source-session.js';
import { checkReleased, outputLocation, sameSourceFact } from './source-recovery.js';
import { budgetCopy, checkBudget } from './budget.js';
import { ControllerError } from './types.js';
import type { ControllerPorts, ControllerBudget, AttemptProgress, CollectionObservation } from './types.js';

const owners = new WeakMap<ControllerPorts['journal'], Map<string, AttemptController>>();

function reservation(input: unknown): Reservation {
  if (!input || typeof input !== 'object' || !('status' in input)) throw new ControllerError('journal');
  return input as Reservation;
}
/** One owner per scoped, admitted and staged runtime. No scheduling or automatic test retry. */
export class AttemptController {
  private readonly options: ControllerPorts;
  private readonly source: SourceSession;
  private actor: LaunchActor | undefined;
  private authority: CollectionAuthority | undefined;
  private pendingLaunch = false;
  private reader: ControlReader | undefined;
  private outputs: OutputCollection | undefined;
  private collection: CollectionObservation | undefined;
  private failedRelease: ReleaseEvidence | undefined;
  private active: Promise<AttemptProgress> | undefined;
  private cancellation: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private cancelRequested = false;
  private cancelReason: StopReason = 'cancelled';
  private urgentStop = false;
  private cleanupFailed = false;
  private released = false;
  private wallHigh = 0;
  private outputDeadline = Infinity;
  private stoppedControlBytes: number | undefined;
  private stoppedRoot: Readonly<OutputRootIdentity> | undefined;
  private readonly ownerKey: string;
  private readonly ownerMap: Map<string, AttemptController>;
  constructor(options: ControllerPorts) {
    const key = copyControlScope(options.input.key);
    if (!isRuntimePlan(options.input.plan)) throw new ControllerError('invalid_input');
    this.options = Object.freeze({ ...options, input: Object.freeze({ key, plan: options.input.plan }) });
    this.source = new SourceSession(this.options);
    this.ownerKey = [key.organizationId, key.workspaceId, key.attemptId, key.generation].join('/').toLowerCase();
    this.ownerMap = owners.get(options.journal) ?? new Map();
    if (this.ownerMap.has(this.ownerKey) || this.ownerMap.size >= 64) throw new ControllerError('busy');
    this.ownerMap.set(this.ownerKey, this); owners.set(options.journal, this.ownerMap);
  }
  launch(budget: ControllerBudget): Promise<AttemptProgress> { return this.run(true, budget); }
  tick(budget: ControllerBudget): Promise<AttemptProgress> { return this.run(false, budget); }
  private run(launch: boolean, input: ControllerBudget): Promise<AttemptProgress> {
    if (this.closed) return Promise.reject(new ControllerError('closed'));
    if (this.active) return Promise.reject(new ControllerError('busy'));
    let resolve!: (value: AttemptProgress) => void; let reject!: (error: unknown) => void;
    const work = new Promise<AttemptProgress>((yes, no) => { resolve = yes; reject = no; });
    this.active = work;
    this.pendingLaunch ||= launch;
    let budget: Readonly<ControllerBudget> | undefined; let invalid: unknown;
    try { budget = budgetCopy(input); } catch (error) { invalid = error; }
    void Promise.resolve().then(() => {
      if (invalid) throw invalid;
      return this.step(budget!);
    }).then(value => { this.active = undefined; resolve(value); }, error => {
      this.pendingLaunch = false;
      this.active = undefined; reject(error instanceof ControllerError ? error : new ControllerError('journal'));
    });
    return work;
  }
  private guard(budget: ControllerBudget): void {
    if (this.closed) throw new ControllerError('closed');
    if (this.cleanupFailed) throw new ControllerError('cleanup');
    checkBudget(budget);
  }
  private now(): number {
    const now = (this.options.wallNow ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < this.wallHigh || now > 8_640_000_000_000_000) throw new ControllerError('clock');
    this.wallHigh = now; return now;
  }
  private async state(launch: boolean): Promise<LaunchState> {
    this.actor ??= this.options.supervisor.actor(this.options.input);
    try {
      if (this.cancelRequested) return await this.actor.cancel(this.cancelReason);
      return await (launch ? this.actor.launch() : this.actor.tick());
    } catch (error) {
      if (busyActor(error)) throw error;
      throw new ControllerError('supervisor');
    }
  }
  private async step(budget: ControllerBudget): Promise<AttemptProgress> {
    this.guard(budget);
    const source = await this.sourceProgress(budget); if (source) return source;
    const current = reservation(await this.options.journal.admission({ kind: 'reservation', key: this.options.input.key }));
    this.guard(budget);
    const released = this.releasedProgress(current); if (released) return released;
    if (!this.source.recovered) this.boundCollection(current);
    this.guard(budget);
    if (!await this.captureCollection(budget)) return { kind: 'deferred', reason: 'journal_busy' };
    return this.advanceRuntime(budget);
  }
  private async sourceProgress(budget: ControllerBudget): Promise<AttemptProgress | null> {
    try { await this.source.load(); }
    catch (error) {
      this.guard(budget);
      if (error instanceof JournalError && error.code === 'queue_full') return { kind: 'deferred', reason: 'journal_busy' };
      throw error;
    }
    this.guard(budget);
    if (this.source.hasPendingPublication) {
      const progress = await this.source.progress();
      if (progress.kind === 'released') this.released = true;
      return progress;
    }
    return null;
  }
  private async advanceRuntime(budget: ControllerBudget): Promise<AttemptProgress> {
    let state: LaunchState;
    try { state = await this.state(this.pendingLaunch && !this.source.recovered); }
    catch (error) {
      this.guard(budget);
      if (busyActor(error)) return { kind: 'deferred', reason: 'journal_busy' };
      throw error;
    }
    this.pendingLaunch = false; this.guard(budget);
    if (this.unstartedCancelled(state)) return this.abortUnstarted();
    if (this.collection) return this.release(state, budget);
    if (this.stoppedControlBytes !== undefined) {
      if (!this.stopped(state)) return { kind: 'runtime', state };
      return this.finish(state, budget);
    }
    return this.advanceControl(state, budget);
  }
  private async captureCollection(budget: ControllerBudget): Promise<boolean> {
    try { this.authority ??= await collectionAuthority(this.options.journal, this.options.input.key, this.options.input.plan.specDigest); }
    catch (error) {
      this.guard(budget);
      if (error instanceof CollectionReadBusy) return false;
      throw error;
    }
    this.guard(budget); return true;
  }
  private releasedProgress(current: Reservation): AttemptProgress | null {
    if (current.status !== 'released') return null;
    if (!current.releaseEvidence && !current.aborted) throw new ControllerError('invalid_input');
    this.released = true;
    return { kind: 'released', collection: current.releaseEvidence?.collection.state ?? 'failed' };
  }
  private boundCollection(current: Reservation): void {
    if (current.budget.timeoutMs > Number.MAX_SAFE_INTEGER - current.admittedAt) throw new ControllerError('clock');
    const remaining = Math.max(0, current.admittedAt + current.budget.timeoutMs - this.now());
    this.outputDeadline = Math.min(this.outputDeadline, performance.now() + remaining);
  }
  private unstartedCancelled(state: LaunchState): boolean {
    return state.launch === 'unclaimed' && (this.cancelRequested || state.cancellation !== 'none');
  }
  private async advanceControl(state: LaunchState, budget: ControllerBudget): Promise<AttemptProgress> {
    const stopped = this.stopped(state);
    const value = await this.control(stopped, budget); this.guard(budget);
    if (!value) {
      if (!stopped) await this.cancel('artifact_incomplete');
      return { kind: 'runtime', state };
    }
    if (value.kind === 'batch') return { kind: 'control', events: value.request.events.length };
    if (value.kind === 'verifying') return value;
    if (stopped && value.cursor === null && value.tail === 'none') {
      await this.closeReader(); this.collection = { state: 'failed', observedAt: this.now() };
      return { kind: 'awaiting_release', collection: 'failed' };
    }
    if (value.consistency !== 'stopped_verified') return { kind: 'runtime', state };
    this.stoppedControlBytes = value.cursor.offset; this.stoppedRoot = value.root;
    return this.finish(state, budget);
  }
  private async finish(state: LaunchState, budget: ControllerBudget): Promise<AttemptProgress> {
    await this.closeReader(); this.guard(budget);
    const snapshot = await this.options.journal.get(this.options.input.key); this.guard(budget);
    const reported=reportedResult(this.authority!,snapshot);
    if (!reported || !this.source.hasCustody && performance.now() >= this.outputDeadline) {
      if (this.source.hasCustody) throw new ControllerError('journal');
      this.collection = { state: 'failed', observedAt: this.now() };
    } else {
      const checkpoint = await this.options.journal.readWrapperCheckpoint(this.options.input.key); this.guard(budget);
      if (!checkpoint || checkpoint.offset !== this.stoppedControlBytes || !this.stoppedRoot) throw new ControllerError('journal');
      const current = reservation(await this.options.journal.admission({ kind: 'reservation', key: this.options.input.key }));
      this.guard(budget);
      if (!await this.source.begin({ authority: this.authority!, current, state, root: this.stoppedRoot, checkpoint, now: this.now() })) {
        return { kind: 'runtime', state };
      }
      this.guard(budget);
      await this.collect(reported, checkpoint.offset, budget);
    }
    if (!this.collection) return { kind: 'awaiting_collection', reason: 'busy' };
    return { kind: 'awaiting_release', collection: this.collection!.state };
  }
  private stopped(state: LaunchState): boolean {
    const view = state.observation;
    return state.launch !== 'unknown' && state.launch !== 'unclaimed' && view !== null
      && (view.state === 'exited' || view.state === 'created');
  }
  private directory(): string {
    return outputLocation(this.options).directory;
  }
  private uid(): number { return outputLocation(this.options).uid; }
  private async control(stopped: boolean, budget: ControllerBudget): Promise<ControlReadValue | null> {
    if (!this.reader) {
      const checkpoint = await this.options.journal.readWrapperCheckpoint(this.options.input.key); this.guard(budget);
      if (this.source.recovered && !sameSourceFact(checkpoint, this.source.checkpoint)) throw new ControllerError('journal');
      this.reader = this.options.createReader({ directory: this.directory(), uid: this.uid(), key: this.options.input.key, checkpoint });
    }
    const read = this.reader.read({ ...budget, stopped,
      deadline: Math.min(budget.deadline, performance.now() + CONTROL_READ_MAX_MS) });
    const result = await this.originals(read, () => this.reader!.close(), false); this.guard(budget);
    if (!result.ok) {
      await this.closeReader();
      if (this.source.recovered) throw new ControllerError('journal');
      this.collection = { state: 'failed', observedAt: this.now() }; return null;
    }
    if (result.value.kind === 'batch') {
      if (this.source.recovered) throw new ControllerError('journal');
      const checkpoint = await this.commitControl(result.value.request);
      this.reader.accept(checkpoint);
    }
    return result.value;
  }
  private async closeReader(): Promise<void> {
    try { await this.reader?.close(); }
    catch { this.cleanupFailed = true; throw new ControllerError('cleanup'); }
  }
  private async commitControl(request: Parameters<ControllerPorts['journal']['commitWrapperBatch']>[0]) {
    try { return await this.options.journal.commitWrapperBatch(request); }
    catch {
      // Preserve the pending immutable batch for ambiguous replay, but fence further execution.
      await this.cancel('artifact_incomplete').catch(() => undefined);
      throw new ControllerError('journal');
    }
  }
  private async originals<T>(operation: { result: Promise<T>; quiesced: Promise<void> },
    close: () => Promise<void>, closeAlways: boolean): Promise<T> {
    let closing: Promise<void> | undefined;
    const closeOnce = () => closing ??= Promise.resolve().then(close);
    const failed = async () => {
      this.cleanupFailed = true;
      await closeOnce().catch(() => undefined);
      throw new ControllerError('cleanup');
    };
    const outcomes = await Promise.allSettled([operation.result.catch(failed), operation.quiesced.catch(failed)]);
    const result = outcomes[0];
    if (result.status !== 'fulfilled' || outcomes[1].status !== 'fulfilled') throw new ControllerError('cleanup');
    if (closeAlways) {
      try { await closeOnce(); } catch { this.cleanupFailed = true; throw new ControllerError('cleanup'); }
    }
    return result.value;
  }
  private async collect(result: NonNullable<CollectionObservation['result']>, controlBytes: number,
    budget: ControllerBudget): Promise<void> {
    this.guard(budget);
    const deadline = Math.min(budget.deadline, performance.now() + OUTPUT_COLLECTION_MAX_MS,
      this.source.recovered ? Infinity : this.outputDeadline);
    if (performance.now() >= deadline) throw new ControllerError('deadline');
    this.outputs = this.options.collectOutputs(collectionOptions(this.authority!,{ directory: this.directory(), uid: this.uid(), key: this.options.input.key,
      reportedResult: result, controlBytes,
      deadline, ...(budget.signal ? { signal: budget.signal } : {}) }));
    const outcome = await this.originals(this.outputs, () => this.outputs!.close(), true);
    if (!outcome.ok && outcome.reason === 'busy') return;
    if (outcome.ok) this.source.success(outcome, () => this.now());
    else this.source.failed(this.now());
    this.collection = { state: outcome.ok ? 'finished' : 'failed', observedAt: this.now(),
      ...(outcome.ok ? { result: outcome.value } : {}) };
    this.guard(budget);
    if (outcome.ok) await this.source.publish();
  }
  private async release(state: LaunchState, budget: ControllerBudget): Promise<AttemptProgress> {
    const current = reservation(await this.options.journal.admission({ kind: 'reservation', key: this.options.input.key }));
    this.guard(budget);
    const runtimeAt = this.now();
    this.failedRelease ??= releaseEvidence({ reservation: current, state,
      collection: { ...this.collection!, observedAt: runtimeAt }, runtimeAt }) ?? undefined;
    const evidence = this.failedRelease;
    if (!evidence) return { kind: 'awaiting_release', collection: this.collection!.state };
    this.guard(budget);
    checkReleased(reservation(await this.options.journal.admission({ kind: 'release', evidence })), evidence);
    this.released = true;
    return { kind: 'released', collection: this.collection!.state };
  }
  private async abortUnstarted(): Promise<AttemptProgress> {
    const current = reservation(await this.options.journal.admission({ kind: 'abortUnstarted', key: this.options.input.key }));
    const key = { organizationId: current.organizationId, workspaceId: current.workspaceId,
      attemptId: current.attemptId, generation: current.generation };
    const empty = ['createToken', 'specDigest', 'runtimeId', 'startToken', 'startClaimedAt', 'launchSettlement', 'releaseEvidence'] as const;
    if (current.status !== 'released' || current.aborted !== true || current.launchClosed !== true || current.launchEpoch !== 0
      || !sameSourceFact(key, this.options.input.key) || !empty.every(field => current[field] === null)) throw new ControllerError('journal');
    this.released = true;
    return { kind: 'released', collection: 'failed' };
  }
  private async finishShutdown(): Promise<void> {
    if (this.released || this.source.hasCustody) return;
    const current = reservation(await this.options.journal.admission({ kind: 'reservation', key: this.options.input.key }));
    if (current.status === 'released') { this.released = true; return; }
    if (!current.createToken) { await this.abortUnstarted(); return; }
    this.actor ??= this.options.supervisor.actor(this.options.input);
    await this.actor.cancel(this.cancelReason);
    if (!this.stopped(await this.actor.tick())) throw new ControllerError('cleanup');
  }
  cancel(reason: StopReason = 'cancelled'): Promise<void> {
    if (this.released || this.source.hasCustody) return Promise.resolve();
    if (!this.cancelRequested) this.cancelReason = reason;
    this.cancelRequested = true; this.pendingLaunch = false;
    const urgent = ['output_limit', 'artifact_incomplete', 'clock_integrity'].includes(reason);
    const escalation = urgent && !this.urgentStop;
    this.urgentStop ||= urgent;
    if (this.cancellation && !escalation) return this.cancellation;
    const previous = this.cancellation;
    let resolve!: () => void; let reject!: (error: unknown) => void;
    const result = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.cancellation = result;
    const operation = this.cancelOperation(reason);
    void Promise.allSettled([previous, operation]).then(outcomes => {
      if (this.cancellation === result) this.cancellation = undefined;
      const failed = outcomes.find(value => value.status === 'rejected');
      if (failed?.status === 'rejected') reject(failed.reason); else resolve();
    });
    return result;
  }
  private cancelOperation(reason: StopReason): Promise<unknown> {
    try {
      // Fence the actor synchronously, before any already-queued continuation can dispatch.
      return this.actor ? this.actor.cancel(reason) : Promise.resolve().then(() =>
        this.options.journal.supervision({ key: this.options.input.key, now: this.now(), cancel: true, reason }));
    } catch (error) { return Promise.reject(error); }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.cancelRequested = true; this.pendingLaunch = false;
    this.closing = Promise.resolve().then(async () => {
      await this.source.load();
      const outcomes = await Promise.allSettled([this.cancel(), this.closeReader(),
        Promise.resolve().then(() => this.outputs?.close()), this.active?.catch(() => undefined)]);
      if (outcomes.some(result => result.status === 'rejected')) throw new ControllerError('cleanup');
      if (this.cleanupFailed) throw new ControllerError('cleanup');
      await this.finishShutdown();
      if (this.actor) await this.options.supervisor.retireOwned(this.options.input);
      this.ownerMap.delete(this.ownerKey);
    });
    return this.closing;
  }
}
