import { createHash, randomUUID } from 'node:crypto';
import { captureLiveMetricSubset } from '@beetle/contracts/api';
import type { LiveMetricScope } from '@beetle/contracts/api';
import { MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import { createK6MetricProfile } from '../../aggregation/index.js';
import type { MetricWindow } from '../../aggregation/index.js';
import type { CompiledInput } from '../input/index.js';
import { createLiveMetricPublisher } from '../live/index.js';
import type { LiveMetricPublisher } from '../live/index.js';
import { createMailboxSink, NativeMailboxError, openNativeMailbox } from '../live-mailbox/index.js';
import type { MailboxFile, MailboxSink } from '../live-mailbox/index.js';
import type { ExecutionClock } from '../execution/index.js';

export interface AttemptLiveState {
  readonly status: 'disabled' | 'open' | 'closed' | 'unavailable';
  readonly reason: string | null;
  readonly producedBytes: number;
  readonly quiescence: 'confirmed' | 'failed' | 'unknown';
}
interface Input {
  readonly suite: CompiledInput['suite']; readonly scope: LiveMetricScope; readonly uid: number;
  readonly maximumBytes: number; readonly timeoutMs: number; readonly signal: AbortSignal; readonly clock: ExecutionClock;
}
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
/** Trusted default subset is derived from the same approved catalogue as the parser. */
export function attemptLiveSubset(suite: CompiledInput['suite']) {
  const approved = createK6MetricProfile(suite).allowedSeries;
  const eligible = approved.filter(item => (item.scope === 'execute' || item.scope === 'engine') && item.tags.phase !== 'prepare');
  const selected = eligible.slice(0, 20).map((item, ordinal) => ({...item, ordinal}));
  const subset = captureLiveMetricSubset({selected, excludedSeries: approved.length - selected.length});
  for (const item of subset.selected) {Object.freeze(item.tags); Object.freeze(item);}
  Object.freeze(subset.selected); Object.freeze(subset); return subset;
}
/** Advisory failures disable publication; failed original cleanup still blocks sealing. */
export class AttemptLive {
  private publisher: LiveMetricPublisher | undefined;
  private sink: MailboxSink | undefined;
  private file: MailboxFile | undefined;
  private failedOwner: MailboxFile | undefined;
  private facts: AttemptLiveState = {status: 'disabled', reason: null, producedBytes: 0, quiescence: 'confirmed'};
  private started: Promise<void> | undefined;
  private starting: Promise<void> | undefined;
  private closing: Promise<AttemptLiveState> | undefined;
  state(): AttemptLiveState {
    const publisher = this.publisher?.state();
    return Object.freeze({...this.facts, producedBytes: this.facts.producedBytes + (this.sink?.state().chargedBytes ?? 0),
      ...(publisher?.reason ? {status: 'unavailable' as const, reason: publisher.reason} : {})});
  }
  start(input: Input, open: typeof openNativeMailbox = openNativeMailbox): Promise<void> {
    if (this.started) return this.started;
    if (this.closing) return Promise.resolve();
    this.facts = {status: 'unavailable', reason: 'setup', producedBytes: 0, quiescence: 'unknown'};
    this.starting = Promise.resolve().then(() => this.initialize(input, open));
    this.started = this.starting.then(async () => {if (!this.publisher) await this.close();});
    return this.started;
  }
  private async initialize(input: Input, open: typeof openNativeMailbox): Promise<void> {
    if (this.closing || input.signal.aborted) return;
    try {
      const subset = attemptLiveSubset(input.suite);
      if (input.maximumBytes <= MAILBOX_BYTES + 512) throw new Error('quota');
      this.facts = {...this.facts, producedBytes: MAILBOX_BYTES};
      this.file = await open({uid: input.uid, signal: input.signal});
      if (this.closing) return;
      this.sink = createMailboxSink({file: this.file, hash, maximumProducedBytes: input.maximumBytes - MAILBOX_BYTES});
      this.publisher = createLiveMetricPublisher({scope: input.scope, producerEpoch: randomUUID(), subset, hash,
        timeoutMs: input.timeoutMs, maximumProducedBytes: input.maximumBytes - MAILBOX_BYTES,
        sink: this.sink, signal: input.signal, clock: input.clock});
      this.facts = {...this.facts, status: 'open', reason: null};
    } catch (error) {
      if (error instanceof NativeMailboxError) this.failedOwner = error.owner;
      this.facts = {...this.facts, status: 'unavailable', reason: 'setup'};
    }
  }
  accept(window: MetricWindow): void {if (!this.closing) this.publisher?.accept(window);}
  close(): Promise<AttemptLiveState> {
    this.closing ??= Promise.resolve().then(() => this.finish()); return this.closing;
  }
  private async closeOriginals(): Promise<void> {
    await this.starting;
    const publisher = await this.publisher?.stop();
    if (publisher?.quiescence === 'failed') throw new Error('cleanup');
    if (!this.publisher) await (this.sink?.close() ?? this.file?.close());
    if (this.failedOwner) throw new Error('cleanup');
  }
  private async finish(): Promise<AttemptLiveState> {
    try {
      await this.closeOriginals();
      this.facts = {...this.facts, status: this.facts.status === 'disabled' ? 'disabled' : this.facts.reason ? 'unavailable' : 'closed', quiescence: 'confirmed'};
    } catch {this.facts = {...this.facts, status: 'unavailable', reason: 'cleanup', quiescence: 'failed'};}
    return this.state();
  }
}
