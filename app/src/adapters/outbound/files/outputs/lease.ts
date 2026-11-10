import { DatabaseSync } from 'node:sqlite';
import { configure, verify } from './lease-database.js';
import { LeaseFile } from './lease-file.js';
import { fail, translated, OutputLeaseError } from './lease-errors.js';
export { OutputLeaseError } from './lease-errors.js';
export type { OutputLeaseErrorCode } from './lease-errors.js';

export interface OutputLease { check(): Promise<void>; close(): Promise<void> }
// Reserve before foreign calls; even a rejected duplicate must never probe the locked inode.
let processOwner: LeaseOwner | undefined;
class LeaseOwner implements OutputLease {
  private db?: DatabaseSync;
  private readonly originals = new Set<Promise<void>>();
  private closing?: Promise<void>;
  private fenced = false;
  private failedCleanup = false;
  private file?: LeaseFile;
  async open(options: { path: string; create: boolean }): Promise<void> {
    try {
      const file = new LeaseFile(options.path); this.file = file;
      const create = options.create;
      if (typeof create !== 'boolean') fail('invalid_input');
      await file.pin(create);
      this.db = new DatabaseSync(file.path, { timeout: 100 });
      await file.check(); configure(this.db, create); await file.check();
    } catch (error) {
      try { await this.close(); } catch { fail('cleanup'); }
      throw translated(error);
    }
  }
  check(): Promise<void> {
    if (this.fenced) return Promise.reject(new OutputLeaseError('closed'));
    // Local lease budget refusal: no queue or extra error vocabulary.
    if (this.originals.size >= 2) return Promise.reject(new OutputLeaseError('owned'));
    const original = Promise.resolve().then(async () => {
      try {
        if (!this.file) fail('closed');
        await this.file.check();
        if (!this.db) fail('closed'); verify(this.db); await this.file.check();
      } catch (error) { this.fenced = true; throw translated(error); }
    });
    this.originals.add(original);
    void original.then(() => this.originals.delete(original), () => this.originals.delete(original));
    return original;
  }
  close(): Promise<void> {
    this.fenced = true;
    this.closing ??= this.drain(); return this.closing;
  }
  private async drain(): Promise<void> {
    await Promise.allSettled([...this.originals]);
    try {
      if (this.failedCleanup || this.file?.cleanupFailed || (this.file && !await this.file.custody.close())) { this.failedCleanup = true; fail('cleanup'); }
      this.db?.close();
    } catch { this.failedCleanup = true; fail('cleanup'); }
    if (processOwner === this) processOwner = undefined;
  }
}
/** Permanent private namespace lease. Caller must drain its file jobs before close. */
export function openOutputLease(options: { path: string; create: boolean }): Promise<OutputLease> {
  if (processOwner) return Promise.reject(translated({ errcode: 5 }));
  const owner = new LeaseOwner(); processOwner = owner;
  return owner.open(options).then(() => owner);
}
