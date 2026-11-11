import type { OutputFileRecord, OutputByteStore } from '../../ports/output-bytes.js';
import type { MetricDigest, MetricReadContext } from '../../ports/run-metrics.js';
import { fail } from './values.js';
export interface ReadOwner extends MetricReadContext { check(): void }
export class ArchiveIO {
  constructor(private readonly bytes: Pick<OutputByteStore, 'read'>, private readonly createDigest: () => MetricDigest,
    private readonly owner: ReadOwner) {}
  async range(record: OutputFileRecord, start: number, endExclusive: number,
    consume: (bytes: Uint8Array) => Promise<void>, full = false): Promise<void> {
    this.owner.check(); const hash = full ? this.createDigest() : undefined; let seen = 0;
    const job = this.bytes.read({record, start, endExclusive, sink: {write: async bytes => {
      this.owner.check(); if (bytes.byteLength > 65536 || seen + bytes.byteLength > endExclusive - start) return fail();
      seen += bytes.byteLength; hash?.update(bytes); await consume(bytes); this.owner.check();
    }}}, {signal: this.owner.signal, deadline: this.owner.deadline, freeSpaceReserveBytes: 0});
    const result = await Promise.allSettled([job.result, job.settled]);
    if (result.some(r => r.status === 'rejected')) return fail(); this.owner.check();
    if (seen !== endExclusive - start || (hash && hash.hex() !== record.artifact.sha256)) return fail();
  }
  async json(record: OutputFileRecord): Promise<unknown> {
    const length = record.artifact.bytes; if (length < 1 || length > 1048576) return fail();
    const data = new Uint8Array(length); let offset = 0;
    await this.range(record, 0, length, async bytes => { data.set(bytes, offset); offset += bytes.byteLength; }, true);
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(data)) as unknown; } catch { return fail(); }
  }
  async lines(record: OutputFileRecord, range: {start: number; end: number}, maximum: number,
    consume: (value: unknown, bytes: number) => void, full = false): Promise<void> {
    let pending = new Uint8Array(maximum); let used = 0; let lines = 0;
    await this.range(record, range.start, range.end, async chunk => {
      let begin = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== 10) continue;
        const length = i - begin + 1; if (used + length > maximum) return fail();
        pending.set(chunk.subarray(begin, i + 1), used); used += length;
        let value: unknown;
        try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(pending.subarray(0, used))); } catch { return fail(); }
        consume(value, used); used = 0; begin = i + 1;
        if (++lines % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); this.owner.check(); }
      }
      if (used + chunk.length - begin > maximum) return fail();
      pending.set(chunk.subarray(begin), used); used += chunk.length - begin;
    }, full);
    if (used) return fail(); pending = new Uint8Array(0);
  }
}
