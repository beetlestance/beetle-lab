import { ControlReadError, CONTROL_READ_MAX_MS } from './types.js';
import type { ControlReadBudget, ControlReadOperation, ControlReadResult, ControlReadValue } from './types.js';
import type { ReaderPorts } from './ports.js';

export function failure(error: unknown): ControlReadResult {
  return { ok: false, reason: error instanceof ControlReadError ? error.reason : 'io' };
}
export function immediate(reason: ControlReadError['reason']): ControlReadOperation {
  return { result: Promise.resolve({ ok: false, reason }), quiesced: Promise.resolve() };
}
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;
export class Operation {
  private cancelled = false;
  private closed = false;
  private expired = false;
  private readonly finish: (value: ControlReadResult) => void;
  private readonly quiet: () => void;
  readonly operation: ControlReadOperation;
  private currentBudget: ControlReadBudget | undefined;
  bytes = 0;
  calls = 0;
  constructor(private readonly ports: ReaderPorts) {
    let finish!: (value: ControlReadResult) => void; let quiet!: () => void;
    const result = new Promise<ControlReadResult>(resolve => { finish = resolve; });
    const quiesced = new Promise<void>(resolve => { quiet = resolve; });
    this.finish = finish; this.quiet = quiet; this.operation = { result, quiesced };
  }
  get budget(): ControlReadBudget { return this.currentBudget!; }
  private guard(): void {
    if (this.closed) throw new ControlReadError('closed');
    if (this.cancelled) throw new ControlReadError('cancelled');
    if (this.expired) throw new ControlReadError('deadline');
  }
  check(): void {
    this.guard();
    if (this.budget.signal && Reflect.apply(aborted, this.budget.signal, [])) this.cancelled = true;
    this.guard(); const now = this.ports.now(); this.guard();
    if (now >= this.budget.deadline) throw new ControlReadError('deadline');
  }
  stop(): void { this.closed = true; this.finish({ ok: false, reason: 'closed' }); }
  async io<T>(action: () => Promise<T>): Promise<T> {
    this.check(); const value = await action(); this.check(); return value;
  }
  run(input: ControlReadBudget, work: () => Promise<ControlReadValue>, settled: () => void): void {
    const budget = snapshotBudget(input); this.currentBudget = budget ?? undefined;
    void Promise.resolve().then(() => this.execute(budget, work)).then(outcome => {
      settled(); this.quiet(); this.finish(outcome);
    });
  }
  private async execute(budget: ControlReadBudget | null, work: () => Promise<ControlReadValue>): Promise<ControlReadResult> {
    let timeout: ReturnType<typeof setTimeout> | undefined; let signal: AbortSignal | undefined;
    let outcome: ControlReadResult;
    const abort = () => { this.cancelled = true; this.finish({ ok: false, reason: 'cancelled' }); };
    try {
      this.guard(); if (!budget) throw new ControlReadError('invalid_options');
      const now = this.ports.now(); this.guard();
      if (!validDeadline(budget.deadline, now)) throw new ControlReadError('invalid_options');
      this.check(); signal = budget.signal;
      if (signal) Reflect.apply(listen, signal, ['abort', abort, { once: true }]);
      this.check();
      timeout = setTimeout(() => { this.expired = true; this.finish({ ok: false, reason: 'deadline' }); },
        Math.max(0, budget.deadline - now));
      const value = await work(); this.check(); outcome = { ok: true, value };
    } catch (error) { outcome = failure(error); }
    clearTimeout(timeout);
    try { if (signal) Reflect.apply(unlisten, signal, ['abort', abort]); }
    catch (error) { outcome = failure(error); }
    return outcome;
  }
}
function validDeadline(deadline: number, now: number): boolean {
  return deadline > now && deadline - now <= CONTROL_READ_MAX_MS;
}
function dataValue(input: ControlReadBudget, key: keyof ControlReadBudget): unknown {
  const field = Object.getOwnPropertyDescriptor(input, key);
  if (!field) return undefined;
  if (!('value' in field)) throw new ControlReadError('invalid_options');
  return field.value;
}
export function snapshotBudget(input: ControlReadBudget): ControlReadBudget | null {
  try {
    const deadline = dataValue(input, 'deadline'); const stopped = dataValue(input, 'stopped');
    const signal = dataValue(input, 'signal');
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)
      || typeof stopped !== 'boolean') return null;
    if (signal !== undefined && !(signal instanceof AbortSignal)) return null;
    return Object.freeze({ deadline, stopped, ...(signal === undefined ? {} : { signal }) });
  } catch { return null; }
}
