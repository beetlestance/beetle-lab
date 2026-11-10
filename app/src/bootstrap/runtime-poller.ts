import { encodeJson } from '@beetle/contracts';
import { immutableSnapshot } from '../domain/namespaces/index.js';
import type { CapacitySource, RuntimeObservation } from '../ports/runtime.js';

export type RuntimeFailureReason = 'source_failure' | 'publication_failure';
export type RuntimePublisher = (observation: RuntimeObservation | null) => Promise<boolean>;
export interface RuntimePollerState {
  readonly status: 'published' | 'unknown' | 'failed' | 'closed';
  readonly sampling: boolean;
  readonly reason: 'unavailable' | 'observation_rejected' | RuntimeFailureReason | 'dispatch_failure' | 'output_failure' | null;
}
export interface RuntimePoller {
  state(): RuntimePollerState;
  close(): Promise<void>;
}
export interface RuntimePollerOptions {
  readonly source: CapacitySource;
  readonly publish: RuntimePublisher;
  readonly intervalMs?: number;
  /** Synchronous failure notification; never await this poller or its composite. */
  readonly onFailure?: (reason: RuntimeFailureReason) => undefined;
}

class Poller implements RuntimePoller {
  private readonly sample: CapacitySource['sample'];
  private readonly closeSource: CapacitySource['close'];
  private readonly publish: RuntimePublisher;
  private readonly interval: number;
  private readonly notifyFailure: RuntimePollerOptions['onFailure'];
  private active: { abort: AbortController; promise: Promise<void> } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private known = false;
  private failure: { error: unknown } | undefined;
  private reason: RuntimePollerState['reason'] = 'unavailable';
  constructor(options: RuntimePollerOptions) {
    const interval = options.intervalMs ?? 250;
    if (!Number.isSafeInteger(interval) || interval < 25 || interval > 60000) throw new Error('Invalid runtime interval');
    this.interval = interval; this.publish = options.publish; this.notifyFailure = options.onFailure;
    this.sample = options.source.sample.bind(options.source);
    this.closeSource = options.source.close.bind(options.source);
    this.launch();
  }
  private launch(): void {
    if (this.closed || this.failure) return;
    this.timer = undefined;
    const abort = new AbortController();
    const promise = Promise.resolve().then(() => this.iterate(abort.signal)).finally(() => {
      this.active = undefined;
      if (!this.closed && !this.failure) this.timer = setTimeout(() => this.launch(), this.interval);
    });
    this.active = { abort, promise };
  }
  private async iterate(signal: AbortSignal): Promise<void> {
    if (this.closed) return;
    let observation: RuntimeObservation | null;
    try { observation = await this.sample(signal); }
    catch (error) { await this.fail(error, 'source_failure'); return; }
    if (this.closed) return;
    try {
      if (observation === null) { await this.revoke('unavailable'); return; }
      const copy = immutableSnapshot(JSON.parse(encodeJson(observation, 65536)) as RuntimeObservation);
      const accepted = await this.publish(copy);
      if (this.closed) return;
      if (accepted === false) { await this.revoke('observation_rejected'); return; }
      if (accepted !== true) throw new Error('Invalid runtime publication result');
      this.known = true; this.reason = null;
    } catch (error) { await this.fail(error, 'publication_failure'); }
  }
  private async revoke(reason: 'unavailable' | 'observation_rejected'): Promise<void> {
    this.reason = reason;
    if (!this.known) return;
    this.known = false;
    if (await this.publish(null) !== true) throw new Error('Runtime revocation refused');
  }
  private async fail(error: unknown, reason: RuntimeFailureReason): Promise<void> {
    this.failure = { error }; this.reason = reason;
    try { this.notifyFailure?.(reason); }
    catch (notification) {
      this.failure = { error: new AggregateError([error, notification], 'Runtime failure notification failed', { cause: notification }) };
    }
    const retained = this.failure.error;
    if (!this.known || this.closed || reason === 'publication_failure') { this.known = false; return; }
    try { await this.revoke('unavailable'); }
    catch (revocation) { this.failure = { error: new AggregateError([retained, revocation], 'Runtime publication failed', { cause: revocation }) }; }
    this.reason = reason;
  }
  state(): RuntimePollerState {
    const status = this.closed ? 'closed' : this.failure ? 'failed' : this.known ? 'published' : 'unknown';
    return Object.freeze({ status, sampling: this.active !== undefined, reason: this.reason });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    clearTimeout(this.timer); this.timer = undefined;
    const active = this.active;
    this.closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([active?.promise, Promise.resolve().then(this.closeSource)]);
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
      if (this.failure) errors.unshift(this.failure.error);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Runtime shutdown failed');
    });
    active?.abort.abort(); return this.closing;
  }
}

/** One installation-owned capacity loop. Published status is not a freshness claim. */
export function startRuntimePoller(options: RuntimePollerOptions): RuntimePoller {
  return new Poller(options);
}
