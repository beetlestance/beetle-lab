import type { Readable } from 'node:stream';
import { ApiFault } from '../api-errors.js';
import {INPUT_CHUNK_BYTES} from '@beetle/contracts/api';

/** Lazy: listeners and reads start only when InputService invokes the source. */
export class ChunkBody {
  fault?: ApiFault;
  constructor(private readonly stream: Readable, private readonly signal: AbortSignal) {}
  private fail(code: 'body_limit' | 'malformed_request' | 'storage_unavailable'): never {
    this.fault = new ApiFault(code); throw this.fault;
  }
  async read(): Promise<Uint8Array> {
    if (this.signal.aborted) this.fail('storage_unavailable');
    const buffer = Buffer.allocUnsafe(INPUT_CHUNK_BYTES);
    let size = 0;
    const abort = () => this.stream.destroy(new ApiFault('storage_unavailable'));
    this.signal.addEventListener('abort', abort, { once: true });
    try {
      for await (const value of this.stream.iterator({ destroyOnReturn: false })) {
        if (!(value instanceof Uint8Array)) this.fail('malformed_request');
        if (value.byteLength > buffer.byteLength - size) this.fail('body_limit');
        buffer.set(value, size); size += value.byteLength;
      }
      if (!size) this.fail('malformed_request');
      return buffer.subarray(0, size);
    } catch {
      if (!this.fault) this.fault = new ApiFault(this.signal.aborted ? 'storage_unavailable' : 'malformed_request');
      throw this.fault;
    } finally { this.signal.removeEventListener('abort', abort); }
  }
}
