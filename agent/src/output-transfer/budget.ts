import type { Operation } from '../backends/docker/index.js';
import { OUTPUT_COLLECTION_MAX_MS } from '../collection/output/index.js';
import { OutputTransferError } from './errors.js';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;
function own(input: Operation, field: keyof Operation): unknown {
  const property = Object.getOwnPropertyDescriptor(input, field);
  if (!property) return undefined;
  if (!('value' in property)) throw new OutputTransferError('invalid_input');
  return property.value;
}
function clock(now: () => number): number {
  try {
    const value = now();
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error();
    return value;
  } catch { throw new OutputTransferError('invalid_input'); }
}

/** Owns a fresh per-request stop hint without racing away issued originals. */
export class Budget {
  readonly deadline: number;
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly caller: AbortSignal | undefined;
  private readonly timer: ReturnType<typeof setTimeout>;
  private last: number;
  private readonly stop = () => this.controller.abort();

  constructor(input: Operation, private readonly now: () => number) {
    try {
      const deadline = own(input, 'deadline'); const signal = own(input, 'signal'); const at = clock(now);
      if (typeof deadline !== 'number' || !Number.isFinite(deadline) || deadline > Number.MAX_SAFE_INTEGER
        || deadline - at > OUTPUT_COLLECTION_MAX_MS) throw new OutputTransferError('invalid_input');
      if (signal !== undefined) Reflect.apply(aborted, signal, []);
      this.deadline = deadline; this.caller = signal as AbortSignal | undefined; this.last = at; this.signal = this.controller.signal;
      this.check();
      if (this.caller) Reflect.apply(listen, this.caller, ['abort', this.stop, { once: true }]);
      this.timer = setTimeout(this.stop, deadline - at);
    } catch (error) {
      if (error instanceof OutputTransferError) throw error;
      throw new OutputTransferError('invalid_input');
    }
  }

  check(): void {
    const at = clock(this.now);
    if (at < this.last || at >= this.deadline || this.signal.aborted
      || (this.caller !== undefined && Reflect.apply(aborted, this.caller, []))) throw new OutputTransferError('interrupted');
    this.last = at;
  }
  finish(): void {
    clearTimeout(this.timer);
    if (this.caller) Reflect.apply(unlisten, this.caller, ['abort', this.stop]);
  }
}
