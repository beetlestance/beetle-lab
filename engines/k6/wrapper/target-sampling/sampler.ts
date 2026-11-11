import { observe } from './observation.js';
import type { TargetSamplingOptions, TargetSamplingOwner, TargetSamplingPhase,
  TargetSamplingReport, TargetSamplingSample } from './types.js';

export class Sampler implements TargetSamplingOwner {
  private readonly controller = new AbortController();
  private readonly samples: TargetSamplingSample[] = [];
  private phase: TargetSamplingPhase = 'before';
  private limited = false;
  private missed = 0;
  private retainedBytes = 0;
  private loop: Promise<void> = Promise.resolve();
  private finishing?: Promise<TargetSamplingReport>;
  private closing?: Promise<void>;
  private cooldown?: ReturnType<typeof setTimeout>;
  private wake: (() => void) | undefined;
  private failure: unknown;
  private failed = false;
  private readonly abort = () => this.stop();

  constructor(private readonly options: TargetSamplingOptions) {
    options.signal.addEventListener('abort', this.abort, { once: true });
    if (options.signal.aborted) this.stop();
  }
  async start(): Promise<void> {
    try { await this.sample(); }
    catch (error) { this.stop(); this.options.signal.removeEventListener('abort', this.abort); throw error; }
    this.phase = 'during';
    this.loop = this.run().catch(error => {
      this.failure = error; this.failed = true; this.stop();
    });
  }
  finish(): Promise<TargetSamplingReport> {
    this.finishing ??= this.finishOnce();
    return this.finishing;
  }
  close(): Promise<void> {
    this.stop();
    this.closing ??= this.drain();
    return this.closing;
  }
  private async finishOnce(): Promise<TargetSamplingReport> {
    this.phase = 'after';
    if (!this.controller.signal.aborted) {
      this.cooldown = setTimeout(() => this.stop(), this.options.config.cooldownMs);
      this.wake?.();
      if (this.options.config.cooldownMs === 0) this.stop();
    }
    await this.drain();
    return Object.freeze({ format: 'beetle-target-runtime', version: 1, scope: 'target-reported',
      samples: Object.freeze([...this.samples]), limited: this.limited, missed: this.missed });
  }
  private stop(): void {
    this.controller.abort();
    if (this.cooldown !== undefined) clearTimeout(this.cooldown);
    this.wake?.();
  }
  private async drain(): Promise<void> {
    await this.loop;
    this.options.signal.removeEventListener('abort', this.abort);
    if (this.failed) throw this.failure;
  }
  private async run(): Promise<void> {
    while (!this.controller.signal.aborted) {
      await this.delay();
      if (!this.controller.signal.aborted) await this.sample();
    }
  }
  private delay(): Promise<void> {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      const timer = setTimeout(done, this.options.config.intervalMs);
      this.wake = done;
    });
  }
  private async sample(): Promise<void> {
    const sample = await observe(this.options, this.phase, this.controller.signal);
    // Reserve the fixed envelope and worst-case counter before retaining each bounded sample.
    const bytes = new TextEncoder().encode(JSON.stringify(sample)).byteLength + 1;
    if (this.samples.length >= 256 || this.retainedBytes + bytes + 1024 > 1048576) {
      this.limited = true;
      this.missed += 1;
      this.stop();
      return;
    }
    this.samples.push(sample);
    this.retainedBytes += bytes;
    if (sample.status === 'unavailable') this.missed += 1;
    if (this.samples.length === 256) {
      this.limited = true;
      this.stop();
    }
  }
}
