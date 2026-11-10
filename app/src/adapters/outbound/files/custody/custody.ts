import type { FileHandle } from 'node:fs/promises';
import type { NativePort } from './native.js';
import { fail } from './errors.js';

export class Custody {
  private readonly handles = new Set<FileHandle>();
  constructor(readonly port: NativePort, readonly context: { readonly signal?: AbortSignal; readonly freeSpaceReserveBytes: number }) {}
  check(): void {
    if (this.context.signal?.aborted) fail('cancelled');
    if (!Number.isSafeInteger(this.context.freeSpaceReserveBytes) || this.context.freeSpaceReserveBytes < 0) fail('invalid_input');
  }
  async open(path: string, flags: number, mode?: number): Promise<FileHandle> {
    this.check();
    const handle = await this.port.open(path, flags, mode);
    this.handles.add(handle); this.check(); return handle;
  }
  async close(): Promise<boolean> {
    let closed = true;
    for (const handle of this.handles) {
      try { await this.port.close(handle); this.handles.delete(handle); }
      catch { closed = false; }
    }
    return closed;
  }
}
