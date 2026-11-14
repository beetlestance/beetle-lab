import { Deadline } from './deadline.js';
import { MetricStream } from './metrics.js';
import { fixedLaunch } from './ports.js';
import type { OwnedChild, ProcessPorts } from './ports.js';
import { snapshot } from './profile.js';
import { ProcessBoundaryError } from './types.js';
import type { NativeProcess, NativeProcessOptions, ProcessCause, ProcessObservation } from './types.js';

const GRACE_MS = 5000;
/** Owns a single child group, including any late spawn after a cancellation fence. */
export class ProcessActor implements NativeProcess {
  private readonly input: NativeProcessOptions;
  private readonly deadline: Deadline;
  private readonly metrics: MetricStream;
  private child: OwnedChild | undefined;
  private pid: number | undefined;
  private spawned = false;
  private exited = false;
  private stdioClosed = false;
  private groupAbsent = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private cause: ProcessCause | null = null;
  private closed = false;
  private started = false;
  private profilePending = false;
  private spawnPending = false;
  private issuingSpawn = false;
  private settled = false;
  private termSent = false;
  private cleanupExpired = false;
  private wallTimer: ReturnType<typeof setTimeout> | undefined;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly result: Promise<ProcessObservation>;
  private resolve!: (value: ProcessObservation) => void;
  private work: Promise<void> = Promise.resolve();
  private readonly childDone: Promise<void>;
  private childResolve!: () => void;
  private closing: Promise<void> | undefined;
  private readonly cancel = () => this.stop('cancelled');

  constructor(input: NativeProcessOptions, private readonly ports: ProcessPorts) {
    this.input = snapshot(input);
    this.deadline = new Deadline(this.input);
    this.metrics = new MetricStream(this.input, cause => this.stop(cause),
      () => this.permitted(), () => this.check());
    this.result = new Promise(resolve => { this.resolve = resolve; });
    this.childDone = new Promise(resolve => { this.childResolve = resolve; });
  }
  run(): Promise<ProcessObservation> {
    if (this.started) return this.result;
    this.started = true;
    if (this.closed) { this.stop('closed'); return this.result; }
    this.input.signal?.addEventListener('abort', this.cancel, { once: true });
    if (this.input.signal?.aborted) { this.stop('cancelled'); return this.result; }
    if (!this.permitted()) return this.result;
    if (!this.watch()) return this.result;
    this.profilePending = true;
    // Publish ownership before validation can synchronously reenter close/cancellation.
    let adopt!: (work: Promise<void>) => void;
    this.work = new Promise(resolve => { adopt = resolve; });
    adopt(this.prepare());
    return this.result;
  }
  private async prepare(): Promise<void> {
    if (this.denied()) { this.profilePending = false; this.check(); return; }
    try {
      await this.ports.validate(this.input);
      this.profilePending = false;
      if (this.permitted()) this.launch();
    } catch { this.profilePending = false; this.stop('profile'); }
    finally { this.check(); }
  }
  private launch(): void {
    // Clock callbacks may reenter cancellation; their returned sample cannot override that fence.
    if (!this.permitted()) return;
    this.spawnPending = true; this.issuingSpawn = true;
    try {
      const launch = fixedLaunch(this.input);
      this.child = this.ports.spawn(this.input.binary, launch.args, launch.options);
      this.bind(this.child);
    } catch { this.spawnPending = false; this.stop('spawn'); }
    finally { this.issuingSpawn = false; this.check(); }
  }
  private bind(child: OwnedChild): void {
    child.once('spawn', () => this.onSpawn(child));
    child.on('error', () => this.stop(this.spawned ? 'child_error' : 'spawn'));
    child.once('exit', (code, signal) => this.onExit(code, signal));
    child.once('close', () => {
      this.stdioClosed = true;
      if (!this.spawned) { this.spawnPending = false; this.stop('spawn'); }
      this.check();
    });
    this.metrics.attach(child.stdout, child.stderr);
    if (this.cause) this.destroyPipes();
  }
  private onSpawn(child: OwnedChild): void {
    this.spawnPending = false; this.spawned = true;
    if (!Number.isSafeInteger(child.pid) || (child.pid ?? 0) <= 1) {
      this.stop('child_error'); this.unknownAfterDrain(); return;
    }
    this.pid = child.pid;
    clearTimeout(this.finishTimer); this.finishTimer = undefined;
    if (!this.permitted()) this.terminate();
    this.check();
  }
  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = true; this.exitCode = code; this.exitSignal = signal;
    this.probe();
    if (!this.groupAbsent && this.pid !== undefined) this.stop('descendants');
    if (!this.drainTimer && !this.termSent) this.drainTimer = setTimeout(() => {
      this.stop('drain_timeout'); this.unknownAfterDrain();
    }, this.input.drainTimeoutMs);
    this.check();
  }
  private permitted(): boolean {
    if (this.denied()) return false;
    try { this.deadline.remaining(); return !this.denied(); }
    catch (error) {
      this.stop(error instanceof ProcessBoundaryError ? error.code : 'clock'); return false;
    }
  }
  private denied(): boolean { return this.cause !== null || this.closed || this.settled; }
  private watch(): boolean {
    if (!this.permitted()) return false;
    let remaining: number;
    try { remaining = this.deadline.remaining(); }
    catch (error) { this.stop(error instanceof ProcessBoundaryError ? error.code : 'clock'); return false; }
    if (this.denied()) return false;
    const timer = setTimeout(() => { this.wallTimer = undefined; this.watch(); }, Math.min(remaining, 50));
    if (this.denied()) { clearTimeout(timer); return false; }
    this.wallTimer = timer;
    return true;
  }
  private stop(cause: ProcessCause): void {
    this.cause ??= cause;
    this.metrics.stop();
    this.destroyPipes();
    this.terminate();
    if (!this.child && !this.issuingSpawn) this.finish();
    else if (this.pid === undefined || this.groupAbsent) this.unknownAfterDrain();
    this.check();
  }
  private destroyPipes(): void { this.child?.stdout.destroy(); this.child?.stderr.destroy(); }
  private terminate(): void {
    if (this.pid === undefined || this.termSent || this.groupAbsent) return;
    this.termSent = true;
    this.signal('SIGTERM');
    // Production grace is fixed and cannot be extended by another cancellation or clock sample.
    this.killTimer = setTimeout(() => {
      this.killTimer = undefined;
      this.signal('SIGKILL'); this.endCleanupAfterDrain(); this.poll();
    }, GRACE_MS);
    this.poll();
  }
  private signal(signal: NodeJS.Signals): void {
    if (this.pid === undefined || this.groupAbsent) return;
    if (this.ports.group(this.pid, signal) === 'absent') this.groupAbsent = true;
  }
  private probe(): void {
    if (this.pid === undefined || this.groupAbsent) return;
    // ESRCH permanently retires this ownership; a later numeric PID can belong to someone else.
    if (this.ports.group(this.pid, 0) === 'absent') this.groupAbsent = true;
  }
  private poll(): void {
    if (this.pollTimer || this.cleanupExpired) return;
    this.probe(); this.check();
    if (this.groupAbsent) return;
    this.pollTimer = setTimeout(() => { this.pollTimer = undefined; this.poll(); }, 25);
  }
  private unknownAfterDrain(): void {
    if (this.finishTimer || this.settled) return;
    this.finishTimer = setTimeout(() => { this.finishTimer = undefined; this.finish(); }, this.input.drainTimeoutMs);
  }
  private endCleanupAfterDrain(): void {
    clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => {
      this.finishTimer = undefined; this.cleanupExpired = true;
      clearTimeout(this.pollTimer); this.pollTimer = undefined;
      this.check(); this.finish();
    }, this.input.drainTimeoutMs);
  }
  private check(): void {
    if (this.issuingSpawn || this.spawnPending) return;
    if (!this.child) {
      this.checkPreparation();
      return;
    }
    if (!this.spawned && this.stdioClosed) { this.childResolve(); this.finish(); return; }
    if (this.isStopped()) {
      this.confirmStopped();
    }
  }
  private checkPreparation(): void { if (!this.profilePending && this.cause) this.finish(); }
  private isStopped(): boolean { return this.exited && this.stdioClosed && this.groupAbsent; }
  private confirmStopped(): void {
    this.childResolve();
    clearTimeout(this.killTimer); this.killTimer = undefined;
    clearTimeout(this.pollTimer); this.pollTimer = undefined;
    if (this.settled) this.clearTimers();
    if (!this.metrics.pending) this.finish();
    else if (this.cause) this.unknownAfterDrain();
  }
  private finish(): void {
    if (this.settled || this.issuingSpawn) return;
    // Final eligibility is sampled separately; an exit callback cannot manufacture an on-time completion.
    this.finalCause();
    if (this.settled) return;
    this.settled = true;
    this.metrics.stop();
    this.input.signal?.removeEventListener('abort', this.cancel);
    this.clearTimers();
    const noChild = !this.child && !this.issuingSpawn;
    this.resolve(this.observation(noChild));
    if (noChild) this.childResolve();
    // Unknown observations retain late-spawn handlers. close() awaits their actual closure.
  }
  private finalCause(): void {
    if (this.cause) return;
    try { this.deadline.remaining(); }
    catch (error) { this.cause ??= error instanceof ProcessBoundaryError ? error.code : 'clock'; }
  }
  private collectionComplete(): boolean {
    return !this.cause && this.isStopped() && this.metrics.ended && !this.metrics.pending;
  }
  private observation(noChild: boolean): ProcessObservation {
    return Object.freeze({ spawned: this.spawned, exitCode: this.exitCode, signal: this.exitSignal,
      cause: this.cause, metricBytes: this.metrics.bytes, diagnosticBytes: this.metrics.diagnosticBytes, warnings: this.metrics.warnings.snapshot(),
      collection: this.collectionComplete() ? 'complete' : 'partial',
      state: this.isStopped() ? 'stopped' : noChild ? 'not_started' : 'unknown', stdioClosed: this.stdioClosed,
      groupAbsent: this.groupAbsent, quiescent: this.quiescent(noChild) });
  }
  private quiescent(noChild: boolean): boolean {
    return (this.isStopped() || noChild) && !this.profilePending && !this.metrics.pending;
  }
  private clearTimers(): void {
    clearTimeout(this.wallTimer); clearTimeout(this.killTimer); clearTimeout(this.finishTimer);
    clearTimeout(this.drainTimer); clearTimeout(this.pollTimer);
    this.wallTimer = undefined; this.killTimer = undefined; this.finishTimer = undefined;
    this.drainTimer = undefined; this.pollTimer = undefined;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.resolve().then(() => this.awaitClose());
    this.stop('closed');
    return this.closing;
  }
  private async awaitClose(): Promise<void> {
    await this.work;
    await this.childDone;
    await this.metrics.close();
  }
}
