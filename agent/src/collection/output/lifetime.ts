import { OUTPUT_COLLECTION_MAX_MS } from './types.js';
import type { OutputCollectionReason } from './types.js';
import { OutputFailure } from './ports.js';
import type { OutputIO, OutputPorts, NativeClosable } from './ports.js';

interface Timing { readonly deadline: number; readonly signal?: AbortSignal }
type Failure = { readonly ok: false; readonly reason: OutputCollectionReason };
type Outcome<T> = T | Failure;
interface Lifetime<T> { readonly result: Promise<Outcome<T>>; readonly quiesced: Promise<void>; close(): Promise<void> }
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;
function failure(error: unknown): Failure {
  if (error instanceof OutputFailure) return { ok: false, reason: error.reason };
  const missing = error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
  return { ok: false, reason: missing ? 'missing' : 'io' };
}
export class OutputLifetime<T extends { readonly ok: true }> implements OutputIO {
  readonly public: Lifetime<T>;
  private readonly finish: (result: Outcome<T>) => void;
  private readonly quiet: () => void;
  private readonly closeGood: () => void;
  private readonly closeBad: (error: OutputFailure) => void;
  private readonly closedOutcome: Promise<void>;
  private options: Timing | undefined;
  private state: OutputCollectionReason | undefined;
  private readonly handles = new Set<NativeClosable>();
  private readonly closes = new Map<NativeClosable, Promise<void>>();
  constructor(private readonly ports: OutputPorts, private readonly release: () => void) {
    let finish!: (result: Outcome<T>) => void; let quiet!: () => void;
    let good!: () => void; let bad!: (error: OutputFailure) => void;
    const result = new Promise<Outcome<T>>(resolve => { finish = resolve; });
    const quiesced = new Promise<void>(resolve => { quiet = resolve; });
    this.closedOutcome = new Promise<void>((resolve, reject) => { good = resolve; bad = reject; });
    void this.closedOutcome.catch(() => undefined);
    this.finish = finish; this.quiet = quiet; this.closeGood = good; this.closeBad = bad;
    this.public = { result, quiesced, close: () => this.close() };
  }
  private stop(reason: OutputCollectionReason): void {
    this.state ??= reason; this.finish({ ok: false, reason: this.state });
  }
  private guard(): void { if (this.state) throw new OutputFailure(this.state); }
  check(): void {
    this.guard();
    if (this.options?.signal && Reflect.apply(aborted, this.options.signal, [])) this.stop('cancelled');
    this.guard(); const now = this.ports.now(); this.guard();
    if (this.options && now >= this.options.deadline) { this.stop('deadline'); this.guard(); }
  }
  async io<T>(action: () => Promise<T>): Promise<T> {
    this.check(); const result = await action(); this.check(); return result;
  }
  own(handle: NativeClosable): void { this.handles.add(handle); }
  private closeOne(handle: NativeClosable): Promise<void> {
    let original = this.closes.get(handle);
    if (!original) { original = Promise.resolve().then(() => handle.close()); this.closes.set(handle, original); }
    return original;
  }
  async closeHandles(handles: readonly NativeClosable[]): Promise<void> {
    const outcomes = await Promise.allSettled(handles.map(handle => this.closeOne(handle)));
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new OutputFailure('io');
  }
  private close(): Promise<void> { this.stop('closed'); return this.closedOutcome; }
  start<O extends Timing>(capture: () => O, work: (options: O) => Promise<T>, afterClose: () => Promise<void>): void {
    let snapshot: O | undefined; let snapshotError: unknown;
    try { snapshot = capture(); this.options = snapshot; } catch (error) { snapshotError = error; }
    void Promise.resolve().then(() => this.execute(snapshotError, () => work(snapshot!), afterClose));
  }
  private setup(): { readonly timer: ReturnType<typeof setTimeout>; readonly remove: () => void } {
    this.check(); const options = this.options!;
    const now = this.ports.now(); this.guard();
    if (options.deadline <= now || options.deadline - now > OUTPUT_COLLECTION_MAX_MS) throw new OutputFailure('invalid_options');
    const abort = () => this.stop('cancelled'); const signal = options.signal;
    if (signal) Reflect.apply(listen, signal, ['abort', abort, { once: true }]);
    const timer = setTimeout(() => this.stop('deadline'), Math.max(0, options.deadline - now));
    return { timer, remove: () => { if (signal) Reflect.apply(unlisten, signal, ['abort', abort]); } };
  }
  private async execute(snapshotError: unknown, work: () => Promise<T>, afterClose: () => Promise<void>): Promise<void> {
    let outcome: Outcome<T>; let cleanup: ReturnType<OutputLifetime<T>['setup']> | undefined;
    try {
      this.guard(); if (snapshotError) throw snapshotError;
      cleanup = this.setup(); outcome = await work();
    } catch (error) { outcome = failure(error); }
    let closeFailure = false;
    try { await this.closeHandles([...this.handles]); } catch { closeFailure = true; outcome = { ok: false, reason: 'io' }; }
    try { if (outcome.ok) { await afterClose(); this.check(); } }
    catch (error) { outcome = failure(error); }
    try { if (cleanup) { clearTimeout(cleanup.timer); cleanup.remove(); } }
    catch { outcome = { ok: false, reason: 'io' }; }
    if (closeFailure) this.closeBad(new OutputFailure('io')); else this.closeGood();
    if (!closeFailure) this.release();
    this.quiet(); this.finish(outcome);
  }
}
