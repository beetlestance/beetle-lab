import type { FileHandle } from 'node:fs/promises';
import { OUTPUT_COLLECTION_MAX_MS } from './types.js';
import type { OutputCollection, OutputCollectionOptions, OutputCollectionResult, OutputCollectionReason } from './types.js';
import { snapshotOptions } from './budget.js';
import type { OutputSnapshot } from './budget.js';
import { nodePorts, OutputFailure } from './ports.js';
import type { OutputIO, OutputPorts } from './ports.js';
import { OutputFiles } from './files.js';
import { verifyOutputs } from './verify.js';

let active = 0;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;
function failure(error: unknown): OutputCollectionResult {
  if (error instanceof OutputFailure) return { ok: false, reason: error.reason };
  const missing = error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
  return { ok: false, reason: missing ? 'missing' : 'io' };
}
function busy(): OutputCollection {
  const closed = Promise.resolve();
  return { result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: closed, close: () => closed };
}
/** Private fault seam; the public collector always supplies production Node ports. */
export function startCollection(input: OutputCollectionOptions, ports: OutputPorts = nodePorts): OutputCollection {
  if (active >= 2) return busy();
  active++; const owner = new Collection(ports); owner.start(input); return owner.public;
}
class Collection implements OutputIO {
  readonly public: OutputCollection;
  private readonly finish: (result: OutputCollectionResult) => void;
  private readonly quiet: () => void;
  private readonly closeGood: () => void;
  private readonly closeBad: (error: OutputFailure) => void;
  private readonly closedOutcome: Promise<void>;
  private options: OutputSnapshot | undefined;
  private state: OutputCollectionReason | undefined;
  private readonly handles = new Set<FileHandle>();
  private readonly closes = new Map<FileHandle, Promise<void>>();
  constructor(private readonly ports: OutputPorts) {
    let finish!: (result: OutputCollectionResult) => void; let quiet!: () => void;
    let good!: () => void; let bad!: (error: OutputFailure) => void;
    const result = new Promise<OutputCollectionResult>(resolve => { finish = resolve; });
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
  own(handle: FileHandle): void { this.handles.add(handle); }
  private closeOne(handle: FileHandle): Promise<void> {
    let original = this.closes.get(handle);
    if (!original) { original = Promise.resolve().then(() => handle.close()); this.closes.set(handle, original); }
    return original;
  }
  async closeHandles(handles: readonly FileHandle[]): Promise<void> {
    const outcomes = await Promise.allSettled(handles.map(handle => this.closeOne(handle)));
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new OutputFailure('io');
  }
  private close(): Promise<void> { this.stop('closed'); return this.closedOutcome; }
  start(input: OutputCollectionOptions): void {
    let snapshotError: unknown;
    try { this.options = snapshotOptions(input); } catch (error) { snapshotError = error; }
    void Promise.resolve().then(() => this.execute(snapshotError));
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
  private async execute(snapshotError: unknown): Promise<void> {
    let outcome: OutputCollectionResult; let cleanup: ReturnType<Collection['setup']> | undefined;
    try {
      this.guard(); if (snapshotError) throw snapshotError;
      cleanup = this.setup();
      const files = new OutputFiles(this.options!, this.ports, this);
      outcome = { ok: true, ...await verifyOutputs(this.options!, files, this) };
    } catch (error) { outcome = failure(error); }
    let closeFailure = false;
    try { await this.closeHandles([...this.handles]); } catch { closeFailure = true; outcome = { ok: false, reason: 'io' }; }
    try { if (outcome.ok) this.check(); } catch (error) { outcome = failure(error); }
    try { if (cleanup) { clearTimeout(cleanup.timer); cleanup.remove(); } }
    catch { outcome = { ok: false, reason: 'io' }; }
    if (closeFailure) this.closeBad(new OutputFailure('io')); else this.closeGood();
    active--; this.quiet(); this.finish(outcome);
  }
}
