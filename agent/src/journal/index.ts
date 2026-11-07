import { Worker } from 'node:worker_threads';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { attemptKey, offerInput, pageInput } from './input.js';
import type { AttemptKey, ErrorCode, Operation, PageRequest, Reply, SnapshotPage, Value } from './protocol.js';
export type { AttemptKey, ErrorCode, PageRequest, SnapshotPage } from './protocol.js';

export class JournalError extends Error {
  constructor(readonly code: ErrorCode) { super(`Journal ${code}`); this.name = 'JournalError'; }
}
export interface JournalOptions {
  path: string;
  /** Trusted packaging option: compiled worker entrypoint. */
  workerUrl?: URL;
  /** Includes the in-flight command; hard maximum 64. */
  queueLimit?: number;
}
interface Pending { resolve(value: Value): void; reject(error: JournalError): void; timer: NodeJS.Timeout }

function validateOptions(options: JournalOptions): void {
  const limit = options.queueLimit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new JournalError('invalid_input');
  const path = options.path;
  if (typeof path !== 'string' || !path || path === ':memory:' || path.length > 4096) throw new JournalError('invalid_input');
}

export class Journal {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly limit: number;
  private nextId = 0;
  private closing = false;
  private failed = false;
  private closePromise: Promise<void> | undefined;
  private terminationPromise: Promise<number> | undefined;
  private readyResolve: () => void = () => undefined;
  private readyReject: (error: JournalError) => void = () => undefined;
  private readonly ready: Promise<void>;

  private constructor(options: JournalOptions) {
    this.limit = options.queueLimit ?? 32;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker = new Worker(options.workerUrl ?? new URL('./worker.js', import.meta.url), {
      workerData: { path: options.path }, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker.on('message', (reply: Reply) => this.receive(reply));
    this.worker.on('error', () => this.fail('unavailable'));
    this.worker.on('exit', () => this.fail('unavailable'));
  }

  static async open(options: JournalOptions): Promise<Journal> {
    validateOptions(options);
    let journal: Journal;
    try { journal = new Journal(options); } catch { throw new JournalError('unavailable'); }
    const timer = setTimeout(() => journal.fail('unavailable'), 5000);
    try { await journal.ready; return journal; }
    catch (error) { await journal.terminate(); throw error; }
    finally { clearTimeout(timer); }
  }

  immutableOffer(input: unknown): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'offer', ...offerInput(input) })) as Promise<AttemptSnapshot>;
  }
  get(key: AttemptKey): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'get', key: attemptKey(key) })) as Promise<AttemptSnapshot>;
  }
  readOffer(key: AttemptKey): Promise<Offer> {
    return this.prepare(() => ({ kind: 'read', key: attemptKey(key) })) as Promise<Offer>;
  }
  durableCancel(key: AttemptKey): Promise<AttemptSnapshot> {
    return this.prepare(() => ({ kind: 'cancel', key: attemptKey(key) })) as Promise<AttemptSnapshot>;
  }
  listOpen(page: PageRequest): Promise<SnapshotPage> {
    return this.prepare(() => ({ kind: 'list', page: pageInput(page) })) as Promise<SnapshotPage>;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    // Worker FIFO drains previously posted commands; close uses one reserved slot.
    this.closePromise = this.send({ kind: 'close' }).then(() => undefined).finally(() => this.terminate());
    return this.closePromise;
  }

  /** Immediate shutdown: pending writes have unknown commit outcome. */
  async abort(): Promise<void> { this.closing = true; this.fail('unavailable'); await this.terminate(); }

  private prepare(operation: () => Operation): Promise<Value> {
    if (this.closing) return Promise.reject(new JournalError('closed'));
    if (this.failed) return Promise.reject(new JournalError('unavailable'));
    if (this.pending.size >= this.limit) return Promise.reject(new JournalError('queue_full'));
    try { return this.send(operation()); } catch { return Promise.reject(new JournalError('invalid_input')); }
  }

  private send(operation: Operation): Promise<Value> {
    if (this.failed) return Promise.reject(new JournalError('unavailable'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('unavailable'), 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ ...operation, id }); } catch { this.fail('unavailable'); }
    });
  }

  private receive(reply: Reply): void {
    if (reply.kind === 'ready') { this.readyResolve(); return; }
    if (reply.kind === 'startup_error') { this.fail(reply.code); return; }
    const pending = this.pending.get(reply.id);
    if (!pending) { this.fail('unavailable'); return; }
    this.pending.delete(reply.id); clearTimeout(pending.timer);
    if (reply.ok) pending.resolve(reply.value);
    else {
      pending.reject(new JournalError(reply.code));
      if (reply.code === 'unavailable') this.fail('unavailable');
    }
  }

  private fail(code: ErrorCode): void {
    if (this.failed) return;
    this.failed = true;
    this.readyReject(new JournalError(code));
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new JournalError(code)); }
    this.pending.clear();
    void this.terminate();
  }

  private terminate(): Promise<number> {
    this.terminationPromise ??= this.worker.terminate();
    return this.terminationPromise;
  }
}

export const openJournal = Journal.open;
