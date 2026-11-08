import { createHash } from 'node:crypto';
import type { Hash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import type { WrapperCursor } from '../../control-protocol/index.js';
import { CONTROL_READ_BYTES, CONTROL_READ_CALLS, ControlReadError } from './types.js';
import type { ControlReadValue } from './types.js';
import { signature } from './custody.js';
import type { Custody } from './custody.js';
import type { Operation } from './operation.js';

export class Verification {
  private readonly pinned: string;
  private readonly hash = createHash('sha256');
  private count = 0;
  private last = -1;
  private offset = 0;
  constructor(readonly phase: 'restart' | 'final', private readonly target: Readonly<WrapperCursor>, stat: BigIntStats) {
    this.pinned = signature(stat);
  }
  matches(stat: BigIntStats): void {
    if (this.phase === 'final' && signature(stat) !== this.pinned) throw new ControlReadError('corruption');
  }
  private consume(bytes: Buffer): void {
    if (bytes.length === 0) throw new ControlReadError('corruption');
    this.hash.update(bytes); this.offset += bytes.length;
    for (const byte of bytes) { if (byte === 10) this.count++; }
    this.last = bytes[bytes.length - 1]!;
  }
  private finish(): Hash {
    const boundary = this.target.offset === 0 ? this.last === -1 : this.last === 10;
    if (!boundary || this.count !== this.target.wrapperSeq || this.hash.copy().digest('hex') !== this.target.prefixSha256) {
      throw new ControlReadError('corruption');
    }
    return this.hash;
  }
  async pass(custody: Custody, op: Operation): Promise<Hash | ControlReadValue> {
    this.matches(await custody.check(op));
    while (this.offset < this.target.offset && op.calls < CONTROL_READ_CALLS && op.bytes < CONTROL_READ_BYTES) {
      const length = Math.min(65_536, this.target.offset - this.offset, CONTROL_READ_BYTES - op.bytes);
      const bytes = await custody.read(op, this.offset, length);
      this.consume(bytes);
    }
    this.matches(await custody.check(op));
    if (this.offset < this.target.offset) return { kind: 'verifying', phase: this.phase,
      verifiedBytes: this.offset, targetBytes: this.target.offset };
    return this.finish();
  }
}
