import type { InputTransferClient, InputTransferOptions } from '@beetle/contracts/api';

type TransferFactory = (options: InputTransferOptions) => InputTransferClient;

/** One session's transfers; replacement waits for the retired client's originals. */
export class SessionTransferOwner {
  private client: InputTransferClient | undefined;
  private detach: (() => void) | undefined;
  private draining: Promise<void> = Promise.resolve();
  constructor(private readonly factory: TransferFactory) {}

  async open(options: InputTransferOptions, signal: AbortSignal): Promise<InputTransferClient | undefined> {
    let drained: Promise<void>;
    do {
      drained = this.draining;
      await drained;
    } while (drained !== this.draining);
    if (signal.aborted) return undefined;
    if (this.client) throw new Error('A transfer session is already active');
    const client = this.factory(options);
    this.client = client;
    const abort = () => { if (this.client === client) this.retire(); };
    signal.addEventListener('abort', abort, { once: true });
    this.detach = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) { this.retire(); await this.draining; return undefined; }
    return client;
  }

  retire(): Promise<void> {
    const client = this.client;
    if (!client) return this.draining;
    this.client = undefined;
    this.detach?.(); this.detach = undefined;
    let resolve!: () => void; let reject!: (error: unknown) => void;
    // Register before close: abort callbacks may synchronously reenter the gate.
    this.draining = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void this.draining.catch(() => { /* Retain rejection for the next open/retire caller. */ });
    try { void Promise.resolve(client.close()).then(resolve, reject); }
    catch (error) { reject(error); }
    return this.draining;
  }
}
