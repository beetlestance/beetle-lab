import { createHash } from 'node:crypto';
import type { Hash } from 'node:crypto';
import { CONTROL_BATCH_EVENTS, CONTROL_FRAME_BYTES, copyWrapperBatch } from '../../control-protocol/index.js';
import type { ControlScope, WrapperBatch, WrapperCheckpoint, WrapperCursor } from '../../control-protocol/index.js';
import { ControlReadError } from './types.js';

/** Only unconsumed bytes are retained: one partial frame and one read window. */
export class Frames {
  private readonly carry = Buffer.allocUnsafe(CONTROL_FRAME_BYTES - 1);
  private carryLength = 0;
  private window: Buffer = Buffer.alloc(0);
  private at = 0;
  position = 0;
  offset = 0;
  seq = 0;
  hash: Hash = createHash('sha256');
  get incomplete(): boolean { return this.carryLength > 0; }
  get buffered(): boolean { return this.at < this.window.length; }
  load(window: Buffer): void { this.window = window; this.at = 0; this.position += window.length; }
  prepareRead(): void { this.window = Buffer.alloc(0); this.at = 0; }
  restore(cursor: Readonly<WrapperCursor>, hash: Hash): void {
    this.position = cursor.offset; this.offset = cursor.offset; this.seq = cursor.wrapperSeq; this.hash = hash;
  }
  private peek(): { prefix: Buffer; suffix: Buffer; length: number; end: number } | null {
    const end = this.window.indexOf(10, this.at);
    if (end < 0) {
      const length = this.carryLength + this.window.length - this.at;
      if (length >= CONTROL_FRAME_BYTES) throw new ControlReadError('corruption');
      this.window.copy(this.carry, this.carryLength, this.at); this.carryLength = length;
      this.at = this.window.length; return null;
    }
    const length = this.carryLength + end - this.at + 1;
    if (length > CONTROL_FRAME_BYTES) throw new ControlReadError('corruption');
    return { prefix: this.carry.subarray(0, this.carryLength), suffix: this.window.subarray(this.at, end + 1), length, end };
  }
  append(input: { key: Readonly<ControlScope>; expected: Readonly<WrapperCheckpoint> | null;
    identity: { dev: string; ino: string }; batch: Readonly<WrapperBatch> | null }): Readonly<WrapperBatch> | null {
    const frame = this.peek(); if (!frame) return null;
    let event: unknown;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      event = JSON.parse(decoder.decode(frame.prefix, { stream: true }) + decoder.decode(frame.suffix.subarray(0, -1)));
    }
    catch { throw new ControlReadError('corruption'); }
    const hash = this.hash.copy().update(frame.prefix).update(frame.suffix);
    const next = { version: 1, ...input.identity, offset: this.offset + frame.length,
      wrapperSeq: this.seq + 1, prefixSha256: hash.copy().digest('hex') };
    let candidate: Readonly<WrapperBatch>;
    try { candidate = copyWrapperBatch({ key: input.key, expected: input.expected, next,
      events: [...(input.batch?.events ?? []), event] }); }
    catch {
      if (input.batch) return null;
      throw new ControlReadError('corruption');
    }
    this.at = frame.end + 1; this.carryLength = 0;
    this.offset = next.offset; this.seq = next.wrapperSeq; this.hash = hash;
    return candidate;
  }
  full(batch: Readonly<WrapperBatch> | null): boolean { return batch?.events.length === CONTROL_BATCH_EVENTS; }
}
