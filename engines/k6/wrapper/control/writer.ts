import type { ControlEvent } from '@beetle/contracts';
import { Operation, type OperationBudget } from './budget.js';
import { JournalError, safeError } from './errors.js';
import { FILE_BYTES, RECORDS, frame, scopeSnapshot, type JournalScope, type ControlDraft } from './frame.js';
import { assertFile, directoryFlags, directoryPath, freshFlags, nodeJournalIo } from './files.js';
import type { JournalFile, JournalIo } from './files.js';

export interface WriterOptions {
  readonly directory: string;
  readonly scope: JournalScope;
  readonly quotaBytes: number;
  readonly io?: JournalIo;
}
export interface ControlWriter {
  append(draft: ControlDraft, budget: OperationBudget): Promise<ControlEvent>;
  /** Quiesces issued I/O; an unresponsive kernel operation can delay cleanup. */
  close(): Promise<void>;
}

class Writer implements ControlWriter {
  private seq = 0;
  private bytes = 0;
  private poisoned = false;
  private closing = false;
  private inFlight: Promise<ControlEvent> | undefined;
  private closePromise: Promise<void> | undefined;
  constructor(private readonly file: JournalFile, private readonly scope: JournalScope,
    private readonly quota: number) {}

  async append(draft: ControlDraft, budget: OperationBudget): Promise<ControlEvent> {
    if (this.closing) throw new JournalError('closed');
    if (this.poisoned) throw new JournalError('poisoned');
    if (this.inFlight) throw new JournalError('busy');
    if (this.seq >= RECORDS) throw new JournalError('record_limit');
    const operation = new Operation(budget);
    const prepared = frame(draft, this.seq + 1, this.scope);
    if (this.bytes + prepared.bytes.length > this.quota) throw new JournalError('quota_limit');
    operation.check();
    const work = this.persist(prepared, operation);
    this.inFlight = work;
    void work.finally(() => { this.inFlight = undefined; }).catch(() => undefined);
    try { return await operation.wait(work); }
    catch (error) { this.poisoned = true; throw safeError(error); }
  }

  private async persist(prepared: ReturnType<typeof frame>, operation: Operation): Promise<ControlEvent> {
    let offset = 0;
    while (offset < prepared.bytes.length) {
      operation.check();
      const { bytesWritten } = await this.file.write(prepared.bytes, offset,
        prepared.bytes.length - offset, this.bytes + offset);
      operation.check();
      if (!Number.isInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > prepared.bytes.length - offset) {
        throw new JournalError('io_failure');
      }
      offset += bytesWritten;
    }
    await this.file.sync(); operation.check();
    if (this.closing) throw new JournalError('closed');
    this.bytes += prepared.bytes.length; this.seq++;
    return prepared.event;
  }

  close(): Promise<void> {
    this.closing = true;
    this.closePromise ??= this.finishClose();
    return this.closePromise;
  }
  private async finishClose(): Promise<void> {
    // Append callers receive the failure. Cleanup still waits for the issued I/O.
    await this.inFlight?.catch(() => undefined);
    try { await this.file.close(); } catch { throw new JournalError('io_failure'); }
  }
}

async function initialize(options: WriterOptions, scope: JournalScope, operation: Operation): Promise<ControlWriter> {
  const io = options.io ?? nodeJournalIo;
  let file: JournalFile | undefined;
  let parent: JournalFile | undefined;
  let ready = false;
  try {
    const path = await directoryPath(options.directory, io, operation); operation.check();
    try { file = await io.open(path, freshFlags, 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new JournalError('already_exists');
      throw error;
    }
    operation.check(); await assertFile(file, operation); operation.check();
    await file.sync(); operation.check();
    parent = await io.open(options.directory, directoryFlags); operation.check();
    await parent.sync(); operation.check();
    const parentToClose = parent; parent = undefined;
    await parentToClose.close(); operation.check();
    ready = true;
    return new Writer(file, scope, options.quotaBytes);
  } finally {
    if (parent) await parent.close();
    if (file && !ready) await file.close();
  }
}

export async function createControlWriter(options: WriterOptions, budget: OperationBudget): Promise<ControlWriter> {
  const scope = scopeSnapshot(options.scope);
  const quota = options.quotaBytes;
  if (!Number.isSafeInteger(quota) || quota < 1024 || quota > FILE_BYTES) throw new JournalError('invalid_options');
  const operation = new Operation(budget);
  // Capture trusted options before any await; later caller mutation has no authority.
  const frozen = Object.freeze({ directory: options.directory, scope, quotaBytes: quota,
    io: options.io ?? nodeJournalIo });
  const work = initialize(frozen, scope, operation);
  try { return await operation.wait(work); }
  catch (error) {
    // Cover deadline expiry between initialization's final check and handoff.
    void work.then(writer => writer.close(), () => undefined).catch(() => undefined);
    throw safeError(error);
  }
}
