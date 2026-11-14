import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { check, RecoveryError } from './types.js';
import type { Owned, RecoveryOperation } from './types.js';
export const native = {open};
const brokenOperations = new Set<RecoveryIO>();
/** One maintenance operation; at most16 originals, no timeout/abort refunds. */
export class RecoveryIO {
  private readonly owned = new Set<Owned<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  private broken = false;
  constructor(readonly operation: RecoveryOperation) {
    if (!(operation.signal instanceof AbortSignal) || !Number.isFinite(operation.deadline)) throw new RecoveryError('invalid_input');
  }
  check(): void {
    if (this.closing || this.broken) throw new RecoveryError('cleanup');
    if (brokenOperations.size) throw new RecoveryError('owned'); check(this.operation);
  }
  private register<T>(value: T, release: () => unknown): Owned<T> {
    const entry = {value, release}; this.owned.add(entry); return entry;
  }
  acquireSync<T>(open: () => T, release: (value: T) => unknown): Owned<T> {
    this.check(); if (this.pending.size + this.owned.size >= 16) throw new RecoveryError('limit');
    const value = open(); return this.register(value, () => release(value));
  }
  async issue<T>(work: () => Promise<T>): Promise<T> {
    this.check(); if (this.pending.size + this.owned.size >= 16) throw new RecoveryError('limit');
    const original = Promise.resolve().then(work); this.pending.add(original);
    try {const value = await original; this.check(); return value;} finally {this.pending.delete(original);}
  }
  async acquire<T>(open: () => Promise<T>, release: (value: T) => unknown): Promise<Owned<T>> {
    this.check(); if (this.pending.size + this.owned.size >= 16) throw new RecoveryError('limit');
    const original = Promise.resolve().then(open).then(value => this.register(value, () => release(value)));
    this.pending.add(original);
    try {const entry = await original; this.check(); return entry;} finally {this.pending.delete(original);}
  }
  acquireFile(path: string, flags: number, mode = 0o600): Promise<Owned<FileHandle>> {
    return this.acquire(() => native.open(path, flags, mode), handle => handle.close());
  }
  close<T>(entry: Owned<T>): Promise<void> {
    if (!this.owned.has(entry) && !entry.close) return Promise.reject(new RecoveryError('invalid_input'));
    if (!entry.close) entry.close = Promise.resolve().then(entry.release).then(() => {this.owned.delete(entry);}, () => {
      this.broken = true; brokenOperations.add(this); throw new RecoveryError('cleanup');
    });
    return entry.close;
  }
  closeAll(): Promise<void> {
    if (!this.closing) this.closing = this.drain(); return this.closing;
  }
  private async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    const outcomes = await Promise.allSettled([...this.owned].map(entry => this.close(entry)));
    if (this.broken || outcomes.some(outcome => outcome.status === 'rejected')) throw new RecoveryError('cleanup');
  }
}
