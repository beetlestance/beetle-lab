import type { Operation } from '../backends/docker/index.js';
import type { OutputScanRequest, OutputScanResult } from '../staging/index.js';
import { identity, optionsCopy, requestCopy, resultCopy } from './bounds.js';
import { Watch } from './watch.js';
import { GuardError } from './types.js';
import type { OutputGuard, OutputGuardOptions, OutputGuardStatus, OutputWatch, OutputWatchRequest } from './types.js';

type Scanner = (request: OutputScanRequest, operation: Operation) => Promise<OutputScanResult>;
export class OutputGuardService implements OutputGuard {
  private readonly options: Required<OutputGuardOptions>;
  private readonly watches = new Map<string, Watch>();
  private running = false;
  private closed = false;
  private clockFailed = false;
  private previousTime = 0;
  private readingTime = false;
  private active = 0;
  private cursor = 0;
  private pumping = false;
  private accepting = false;
  private scanTimer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private closing?: Promise<void>;
  constructor(options: OutputGuardOptions, private readonly scan: Scanner) {
    this.options = optionsCopy(options);
    if (typeof scan !== 'function') throw new GuardError('invalid_input');
  }
  start(): void {
    if (this.closed) throw new GuardError('closed');
    if (this.running) return;
    this.running = true;
    this.watchdog = setInterval(() => this.checkFreshness(), Math.min(this.options.intervalMs, this.options.ttlMs));
    this.checkFreshness();
    this.pump();
  }
  watch(input: OutputWatchRequest): OutputWatch {
    if (this.closed) throw new GuardError('closed');
    if (this.accepting) throw new GuardError('capacity');
    this.accepting = true;
    try { return this.admit(input); }
    finally { this.accepting = false; }
  }
  private admit(input: OutputWatchRequest): OutputWatch {
    if (this.closed) throw new GuardError('closed');
    const request = requestCopy(input);
    if (this.closed) throw new GuardError('closed');
    const id = identity(request);
    const existing = this.watches.get(id);
    if (existing) {
      if (existing.request.plan !== request.plan || existing.request.outputBytes !== request.outputBytes) throw new GuardError('conflict');
      return existing;
    }
    if (this.watches.size >= 64) throw new GuardError('capacity');
    const watch = new Watch(request, () => { this.watches.delete(id); }, reason => this.options.stop(request.key, reason),
      () => this.checkFreshness());
    this.watches.set(id, watch);
    watch.registeredAt = this.now();
    if (this.clockFailed) watch.stop('artifact_incomplete');
    this.pump();
    return watch;
  }
  status(): OutputGuardStatus {
    this.checkFreshness();
    return { running: this.running, closed: this.closed, watched: this.watches.size,
      ready: this.running && !this.closed && !this.clockFailed && [...this.watches.values()].every(watch => !watch.closed && !watch.stopped && watch.lastKnownAt !== null) };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.running = false;
    clearTimeout(this.scanTimer);
    clearInterval(this.watchdog);
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    this.closing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    void Promise.allSettled([...this.watches.values()].map(watch => watch.close())).then(results => {
      if (results.some(result => result.status === 'rejected')) reject(new GuardError('cleanup'));
      else resolve();
    });
    return this.closing;
  }
  private now(): number | null {
    if (this.clockFailed) return null;
    if (this.readingTime) { this.failClock(); return null; }
    this.readingTime = true;
    try {
      const value = this.options.monotonicNow();
      if (this.clockFailed) return null;
      if (!Number.isFinite(value) || value < this.previousTime) throw new GuardError('invalid_input');
      this.previousTime = value;
      return value;
    } catch {
      this.failClock();
      return null;
    } finally { this.readingTime = false; }
  }
  private failClock(): void {
    this.clockFailed = true;
    for (const watch of this.watches.values()) watch.stop('artifact_incomplete');
  }
  private checkFreshness(): void {
    if (!this.running || this.closed) return;
    const now = this.now();
    if (now === null) return;
    for (const watch of this.watches.values()) {
      const at = watch.lastKnownAt ?? watch.registeredAt;
      if (at !== null && now - at >= this.options.ttlMs) watch.stop('artifact_incomplete');
    }
  }
  private pump(): void {
    if (this.pumping || !this.running || this.closed || this.clockFailed) return;
    this.pumping = true;
    try { this.fill(); } finally { this.pumping = false; }
    clearTimeout(this.scanTimer);
    if (this.running && !this.closed) this.scanTimer = setTimeout(() => this.pump(), this.options.intervalMs);
  }
  private fill(): void {
    const watches = [...this.watches.values()];
    const now = this.now();
    if (now === null || this.closed) return;
    for (let count = 0; count < watches.length && this.active < 2; count++) {
      const index = this.cursor % watches.length;
      const watch = watches[index];
      this.cursor = (index + 1) % watches.length;
      if (watch && !watch.closed && !watch.stopped && !watch.scan && watch.due <= now) this.issue(watch, now);
    }
  }
  private issue(watch: Watch, startedAt: number): void {
    this.active++;
    const controller = new AbortController();
    watch.controller = controller;
    // Defer foreign code until the original is owned by both registry and watch.
    watch.scan = Promise.resolve().then(async () => {
      const timeout = setTimeout(() => controller.abort(), this.options.sampleTimeoutMs);
      try {
        if (watch.closed || this.closed) return;
        const request = Object.freeze({ ...watch.request, minimumFreeBytes: this.options.minimumFreeBytes });
        const raw = await this.scan(request, { deadline: startedAt + this.options.sampleTimeoutMs, signal: controller.signal });
        let result: OutputScanResult;
        try { result = resultCopy(raw); }
        catch { result = { kind: 'unknown', reason: 'invalid_input' }; }
        if (controller.signal.aborted && result.kind !== 'unknown') result = { kind: 'unknown', reason: 'deadline' };
        this.complete(watch, result, startedAt);
      } catch { this.complete(watch, { kind: 'unknown', reason: 'io' }, startedAt); }
      finally { clearTimeout(timeout); }
    }).then(() => {
      watch.scan = undefined;
      watch.controller = undefined;
      this.active--;
      this.pump();
    });
  }
  private complete(watch: Watch, result: OutputScanResult, startedAt: number): void {
    if (result.kind === 'unknown' && result.reason === 'cleanup') watch.failed = true;
    if (this.fenced(watch)) return;
    const now = this.now();
    if (now === null || this.fenced(watch)) return;
    watch.due = now + this.options.intervalMs;
    if (result.kind === 'unknown') { this.unknown(watch, result.reason); return; }
    if (!this.validTime(result.startedAt, startedAt, now)) { this.unknown(watch, 'invalid_input'); return; }
    if (result.kind === 'limit') { this.limit(watch, result.reason === 'disk'); return; }
    this.known(watch, result);
  }
  private fenced(watch: Watch): boolean { return watch.closed || watch.stopped || this.closed; }
  private validTime(at: number, start: number, now: number): boolean {
    return at >= start && at <= now && now - at < this.options.ttlMs;
  }
  private unknown(watch: Watch, reason: string): void {
    if (reason !== 'busy') watch.initialResult(false);
    if (['cleanup', 'custody', 'bounds', 'invalid_input'].includes(reason)) watch.stop('artifact_incomplete');
  }
  private limit(watch: Watch, disk: boolean): void {
    const targets = disk ? this.watches.values() : [watch];
    for (const target of targets) target.stop('output_limit');
  }
  private known(watch: Watch, result: Extract<OutputScanResult, { kind: 'known' }>): void {
    const disk = result.freeBytes <= this.options.minimumFreeBytes;
    if (result.chargedBytes > watch.request.outputBytes || disk) { this.limit(watch, disk); return; }
    watch.lastKnownAt = result.startedAt;
    watch.initialResult(true);
  }
}
