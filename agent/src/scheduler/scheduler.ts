import { performance } from 'node:perf_hooks';
import type { Scope } from '../admission/index.js';
import { Discovery } from './discovery.js';
import { SchedulerError } from './types.js';
import type { Scheduler, SchedulerOptions, SchedulerStatus } from './types.js';

const MAX_DRIVES = 64;
interface Work { readonly abort: AbortController; readonly original: Promise<void> }

function timing(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new SchedulerError('invalid_input');
  return value;
}
function identity(key: Scope): string {
  return JSON.stringify([key.organizationId, key.workspaceId, key.attemptId, key.generation]);
}

class Loop implements Scheduler {
  private readonly interval: number;
  private readonly timeout: number;
  private readonly work = new Map<string, Work>();
  private running = false;
  private closed = false;
  private lastError: SchedulerStatus['lastError'] = null;
  private timer: NodeJS.Timeout | undefined;
  private pass: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private readonly discovery = new Discovery();
  private chargedOffset = 0;

  constructor(private readonly options: SchedulerOptions) {
    this.interval = timing(options.intervalMs ?? 250, 50, 5000);
    this.timeout = timing(options.operationTimeoutMs ?? 30_000, 100, 300_000);
  }

  start(): void {
    if (this.closed) throw new SchedulerError('closed');
    if (this.running) return;
    this.running = true; this.schedule(0);
  }

  status(): SchedulerStatus {
    return { running: this.running, closed: this.closed, outstanding: this.work.size, lastError: this.lastError };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.running = false;
    if (this.timer) clearTimeout(this.timer);
    // Cache ownership before abort listeners can synchronously reenter close.
    this.closing = Promise.resolve().then(() => this.drain());
    for (const work of this.work.values()) work.abort.abort();
    return this.closing;
  }

  private async drain(): Promise<void> {
    await this.pass;
    // A late scan cannot dispatch after closed; every original is now known.
    await Promise.allSettled([...this.work.values()].map(work => work.original));
  }

  private schedule(delay: number): void {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // Reserve the original lane before invoking even a synchronous/reentrant port.
      this.pass = Promise.resolve().then(async () => { if (!this.closed) await this.scan(); })
        .catch(() => { this.lastError = 'scan'; }).finally(() => {
        this.pass = undefined; this.schedule(this.interval);
      });
    }, delay);
  }

  private async scan(): Promise<void> {
    for (const lane of this.discovery.nextPass()) {
      if (this.closed || this.work.size >= MAX_DRIVES) return;
      const request = this.discovery.request(lane, MAX_DRIVES - this.work.size);
      const page = await this.options.journal.scanRunnable(request);
      if (this.closed) return;
      const attempts = this.discovery.validate(request, page);
      if (lane === 'charged') this.dispatchCharged(attempts);
      else for (const key of attempts) this.dispatch(key);
      if (this.closed) return;
      this.discovery.considered(request, page);
    }
  }

  private dispatchCharged(attempts: readonly Scope[]): void {
    if (attempts.length === 0) { this.chargedOffset = 0; return; }
    const start = this.chargedOffset % attempts.length;
    for (let index = 0; index < attempts.length; index++) this.dispatch(attempts[(start + index) % attempts.length]!);
    // Rotate by one so transient journal saturation cannot always reject the same
    // tail. Larger fixed strides can permanently skip cohorts at smaller capacity.
    this.chargedOffset = (start + 1) % attempts.length;
  }

  private dispatch(key: Scope): void {
    if (this.closed || this.work.size >= MAX_DRIVES) return;
    const id = identity(key);
    if (this.work.has(id)) return;
    let deadline: number;
    try {
      const now = (this.options.monotonicNow ?? (() => performance.now()))();
      if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - this.timeout) throw new SchedulerError('invalid_input');
      deadline = now + this.timeout;
    } catch { this.lastError = 'clock'; return; }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeout);
    // Enter ownership before the trusted service is invoked, including sync throws.
    const original = Promise.resolve().then(async () => {
      if (this.closed || abort.signal.aborted) return;
      await this.options.installation.drive(key, { deadline, signal: abort.signal });
    }).catch(() => { this.lastError = 'drive'; }).finally(() => {
      clearTimeout(timer); this.work.delete(id);
    });
    this.work.set(id, { abort, original });
  }
}

export function createScheduler(options: SchedulerOptions): Scheduler { return new Loop(options); }
