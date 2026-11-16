import { check } from './capture.js';
import { FileLease } from './lease.js';
import { checkRoot } from './root.js';
import type { NamedIdentity } from './root.js';
import { ProviderError } from './types.js';

interface StreamOptions {
  readonly path: string;
  readonly bytes: number;
  readonly signal: AbortSignal;
  readonly root: NamedIdentity;
  readonly retired: () => void;
}
export class InputStream implements AsyncIterableIterator<Uint8Array> {
  private readonly controller = new AbortController();
  private lease: FileLease | undefined;
  private active: Promise<IteratorResult<Uint8Array>> | undefined;
  private returned: Promise<IteratorResult<Uint8Array>> | undefined;
  private stopped = false;
  private consumed = false;
  private offset = 0;
  private readonly abort = () => this.controller.abort();
  constructor(private readonly options: StreamOptions) {
    options.signal.addEventListener('abort', this.abort, { once: true });
    if (options.signal.aborted) this.abort();
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    if (this.consumed) throw new ProviderError('busy');
    this.consumed = true; return this;
  }
  next(): Promise<IteratorResult<Uint8Array>> {
    if (this.active) return Promise.reject(new ProviderError('busy'));
    if (this.stopped) return Promise.resolve({ done: true, value: undefined });
    const operation = this.advance(); this.active = operation;
    void operation.then(() => { this.active = undefined; }, () => { this.active = undefined; });
    return operation;
  }
  private async advance(): Promise<IteratorResult<Uint8Array>> {
    try {
      check(this.controller.signal);
      await checkRoot(this.options.root); check(this.controller.signal);
      if (!this.lease) {
        this.lease = FileLease.acquire(this.options.path);
        await this.lease.open(this.options.bytes, this.controller.signal);
        if (this.lease.size !== this.options.bytes) throw new ProviderError('io');
      }
      if (this.offset === this.options.bytes) {
        await this.finish(); return { done: true, value: undefined };
      }
      const chunk = await this.lease.read(this.offset, Math.min(65_536, this.options.bytes - this.offset), this.controller.signal);
      if (chunk.byteLength === 0) throw new ProviderError('io');
      this.offset += chunk.byteLength;
      await checkRoot(this.options.root); check(this.controller.signal);
      return { done: false, value: chunk };
    } catch (error) {
      await this.finish();
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('io');
    }
  }
  return(): Promise<IteratorResult<Uint8Array>> {
    this.stopped = true;
    this.returned ??= Promise.resolve().then(() => this.drain());
    this.controller.abort(); return this.returned;
  }
  private async drain(): Promise<IteratorResult<Uint8Array>> {
    try { await this.active; } catch { /* Original failure is delivered to next's caller. */ }
    try { await this.finish(); }
    catch (error) {
      // Custody errors belong to next; only uncertain native cleanup blocks return.
      if (this.lease?.failed) throw error;
    }
    return { done: true, value: undefined };
  }
  private async finish(): Promise<void> {
    this.stopped = true;
    try { await this.lease?.close(); }
    finally {
      this.options.signal.removeEventListener('abort', this.abort);
      if (!this.lease?.failed) this.options.retired();
    }
  }
}
