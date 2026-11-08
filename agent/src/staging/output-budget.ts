import { performance } from 'node:perf_hooks';
import type { Operation } from '../backends/docker/index.js';
import { Boundary } from './bounds.js';
import type { OutputScanReason } from './output-types.js';

export class ScanFailure extends Error {
  constructor(readonly reason: OutputScanReason) { super(`Output scan ${reason}`); }
}
export class ScanLimit extends Error {
  constructor(readonly reason: 'output' | 'disk') { super(`Output scan limit ${reason}`); }
}
export function data(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !('value' in descriptor)) throw new ScanFailure('invalid_input');
  return descriptor.value;
}
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
export function scanBudget(input: Operation): Operation {
  const deadline = data(input, 'deadline');
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) throw new ScanFailure('invalid_input');
  const remaining = deadline - performance.now();
  if (remaining <= 0 || remaining > 30_000) throw new ScanFailure('invalid_input');
  const descriptor = Object.getOwnPropertyDescriptor(input, 'signal');
  if (!descriptor) return { deadline };
  const signal = data(input, 'signal');
  if (!(signal instanceof AbortSignal)) throw new ScanFailure('invalid_input');
  Reflect.apply(aborted, signal, []);
  return { deadline, signal };
}
export class ScanBoundary extends Boundary {
  private calls = 0;
  private charge(): void { if (++this.calls > 2048) throw new ScanFailure('bounds'); }
  /** Account for the future original close before issuing a directory open. */
  reserveClose(): void { this.check(); this.charge(); }
  override wait<T>(issue: () => Promise<T>): Promise<T> { this.charge(); return super.wait(issue); }
}
