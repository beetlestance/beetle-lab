import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import type { Operation } from '../backends/docker/index.js';
import { StagingError } from './types.js';

export function snapshot<T>(value: T, limit: number): T {
  return freeze(JSON.parse(encodeJson(value, limit)) as T);
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** One sequential issued operation is retained after failure until its outcome is known. */
export class Boundary {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private pending: Promise<unknown> | undefined;
  private failed: StagingError | undefined;
  private readonly external: AbortSignal | undefined;
  private readonly abort = () => this.fail(new StagingError('cancelled'));
  private deadline: number;
  private wallCheck: (() => void) | undefined;
  constructor(operation: Operation) {
    if (operation.signal !== undefined && !(operation.signal instanceof AbortSignal)) throw new StagingError('invalid_input');
    if (!Number.isFinite(operation.deadline)) throw new StagingError('invalid_input');
    this.deadline = Math.min(operation.deadline, performance.now() + 30_000);
    this.external = operation.signal;
    this.signal = this.controller.signal;
    this.timer = setTimeout(() => this.fail(new StagingError('deadline')), Math.max(0, this.deadline - performance.now()));
    this.external?.addEventListener('abort', this.abort, { once: true });
    if (this.external?.aborted) this.abort();
  }
  bindWall(deadlineMs: number, now: () => number): void {
    let last = now();
    this.deadline = Math.min(this.deadline, performance.now() + Math.max(0, deadlineMs - last));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(new StagingError('deadline')), Math.max(0, this.deadline - performance.now()));
    this.wallCheck = () => {
      const current = now();
      if (!Number.isSafeInteger(current) || current < last) this.fail(new StagingError('clock_fenced'));
      if (current >= deadlineMs) this.fail(new StagingError('deadline'));
      last = current;
    };
    this.check();
  }
  check(): void {
    this.wallCheck?.();
    if (performance.now() >= this.deadline) this.fail(new StagingError('deadline'));
    if (this.failed) throw this.failed;
  }
  fail(error: StagingError): void { this.failed ??= error; this.controller.abort(); }
  async wait<T>(issue: () => Promise<T>): Promise<T> {
    this.check();
    const work = issue();
    this.pending = work;
    let abort: () => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(this.failed ?? new StagingError('cancelled'));
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
    });
    try {
      const result = await Promise.race([work, stopped]);
      this.pending = undefined; this.check(); return result;
    } finally { this.signal.removeEventListener('abort', abort); }
  }
  async drain(): Promise<void> {
    try { await this.pending; } catch { /* Failure is already reflected in the result; await proves quiescence. */ }
    this.pending = undefined;
  }
  dispose(): void { clearTimeout(this.timer); this.external?.removeEventListener('abort', this.abort); }
}
