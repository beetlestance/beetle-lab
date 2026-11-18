import { createHash } from 'node:crypto';
import { OutputFailure } from '../output/index.js';
import type { PrefixFiles } from './files.js';

/** One bounded line plus a 64 KiB read buffer; never reads beyond the captured extent. */
export class PrefixLines {
  private readonly buffer = Buffer.alloc(65536);
  private readonly record: Buffer;
  private calls = 0;
  private readonly hash = createHash('sha256');
  private position = 0;
  private offset = 0;
  private available = 0;
  private consumed = 0;
  constructor(
    private readonly files: PrefixFiles,
    private readonly lane: 'data' | 'index',
    private readonly expected: { bytes: number; sha256: string },
  ) {
    this.record = Buffer.alloc(lane === 'data' ? 1048576 : 1024);
  }
  async next(maximum: number): Promise<{ value: unknown; bytes: number; offset: number } | undefined> {
    this.checkMaximum(maximum);
    let length = 0;
    while (true) {
      if (!(await this.refill())) {
        if (length) throw new OutputFailure('integrity');
        return undefined;
      }
      const found = this.buffer.indexOf(10, this.offset);
      const newline = found >= 0 && found < this.available;
      const end = newline ? found + 1 : this.available;
      const piece = this.buffer.subarray(this.offset, end);
      if (length + piece.length > maximum) throw new OutputFailure('integrity');
      piece.copy(this.record, length);
      length += piece.length;
      this.offset = end;
      if (!newline) continue;
      const offset = this.consumed;
      this.consumed += length;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(this.record.subarray(0, length));
        return { value: JSON.parse(text) as unknown, bytes: length, offset };
      } catch {
        throw new OutputFailure('integrity');
      }
    }
  }
  private checkMaximum(maximum: number): void {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > this.record.length)
      throw new OutputFailure('invalid_options');
  }
  private async refill(): Promise<boolean> {
    if (this.offset < this.available) return true;
    if (this.position === this.expected.bytes) return false;
    if (++this.calls > 4 * Math.ceil(this.expected.bytes / 65536) + 1024) throw new OutputFailure('integrity');
    this.available = await this.files.read(this.lane, this.buffer, this.position);
    this.offset = 0;
    this.position += this.available;
    this.hash.update(this.buffer.subarray(0, this.available));
    return true;
  }
  verify(): void {
    if (
      this.consumed !== this.expected.bytes ||
      this.offset !== this.available ||
      this.hash.digest('hex') !== this.expected.sha256
    )
      throw new OutputFailure('integrity');
  }
}
