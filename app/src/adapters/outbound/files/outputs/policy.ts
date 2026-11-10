import { types } from 'node:util';
import type { OutputFileContext } from '../../../../ports/output-bytes.js';
import { fields } from './capture.js';
import { fail } from './errors.js';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function reserve(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('invalid_input');
  return value;
}
export class JobPolicy {
  readonly controller = new AbortController();
  private previous = 0;
  private signal?: AbortSignal;
  private deadline = 0;
  reserve = 0;
  constructor(private readonly clock: () => number) {}
  capture(context: OutputFileContext): void {
    if (context === null || typeof context !== 'object' || types.isProxy(context)) fail('invalid_input');
    const names = Object.hasOwn(context, 'signal') ? ['signal', 'deadline', 'freeSpaceReserveBytes'] : ['deadline', 'freeSpaceReserveBytes'];
    const value = fields(context, names);
    const now = this.time();
    if (typeof value.deadline !== 'number' || !Number.isFinite(value.deadline)) fail('invalid_input');
    if (value.deadline - now > 300_000) fail('invalid_input');
    this.deadline = value.deadline; this.reserve = reserve(value.freeSpaceReserveBytes);
    if (value.signal !== undefined) {
      try { Reflect.apply(aborted, value.signal, []); } catch { fail('invalid_input'); }
      this.signal = value.signal as AbortSignal;
    }
    this.check();
  }
  private time(): number {
    const now = this.clock();
    if (!Number.isFinite(now) || now < this.previous) fail('deadline');
    this.previous = now; return now;
  }
  check(): void {
    if (this.controller.signal.aborted) fail('cancelled');
    if (this.signal && Reflect.apply(aborted, this.signal, [])) fail('cancelled');
    if (this.time() >= this.deadline) fail('deadline');
  }
}
