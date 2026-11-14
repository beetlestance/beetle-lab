import type { NativeWarnings } from '@beetle/contracts/k6-warnings';
const LINE = 4096;
/** Bounded transient parsing only; snapshots never include native strings. */
export class WarningClassifier {
  private readonly line = Buffer.alloc(LINE);
  private length = 0;
  private skipping = false;
  private finished = false;
  private partial = false;
  private readonly counts = {insufficientVus: 0, highCardinality: 0, maxDuration: 0, otherWarnings: 0, discardedSegments: 0};
  private discard(): void { this.partial = true; this.counts.discardedSegments++; }
  push(bytes: Uint8Array): void {
    if (this.finished) return;
    if (bytes.length > 65536) { this.length = 0; this.skipping = true; this.discard(); return; }
    for (const byte of bytes) {
      if (byte === 10) {
        if (!this.skipping) this.record();
        this.length = 0; this.skipping = false;
      } else if (!this.skipping) {
        if (this.length === LINE) { this.length = 0; this.skipping = true; this.discard(); }
        else this.line[this.length++] = byte;
      }
    }
  }
  private record(): void {
    if (!this.length) return;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(this.line.subarray(0, this.length)));
      if (!parsed || typeof parsed !== 'object' || !('level' in parsed) || !('msg' in parsed)) { this.discard(); return; }
      const {level, msg} = parsed;
      if (typeof msg !== 'string') { this.discard(); return; }
      this.classify(level, msg);
    } catch { this.discard(); }
  }
  private classify(level: unknown, msg: string): void {
    if (level !== 'warning' && level !== 'warn') {
      if (!['info', 'error', 'debug', 'trace', 'fatal', 'panic'].includes(String(level))) this.discard();
      return;
    }
    if (/^Insufficient VUs,/.test(msg)) this.counts.insufficientVus++;
    else if (/high cardinality|too many time series/i.test(msg)) this.counts.highCardinality++;
    else if (/maxDuration|maximum duration/i.test(msg)) this.counts.maxDuration++;
    else { this.counts.otherWarnings++; this.partial = true; }
  }
  finish(): void {
    if (this.finished) return;
    if (this.length || this.skipping) this.discard();
    this.length = 0; this.line.fill(0); this.finished = true;
  }
  interrupt(): void { if (!this.finished) { this.partial = true; this.finish(); } }
  snapshot(): NativeWarnings {
    return Object.freeze({...this.counts, coverage: this.finished && !this.partial ? 'complete' : 'partial'});
  }
}
