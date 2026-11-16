import { WarningClassifier } from './warnings.js';
import type { Readable } from 'node:stream';
import type { NativeProcessOptions, ProcessCause } from './types.js';

const CHUNK = 65_536;
const RETAINED_LIMIT = 8_388_608;
/** One read and one awaited delivery; no queue and no final materialization. */
export class MetricStream {
  readonly warnings = new WarningClassifier();
  bytes = 0;
  diagnosticBytes = 0;
  ended = false;
  pending = false;
  private stopped = false;
  private readonly abort = new AbortController();
  private issued: Promise<void> = Promise.resolve();
  constructor(private readonly input: NativeProcessOptions,
    private readonly fail: (cause: ProcessCause) => void,
    private readonly decision: () => boolean,
    private readonly changed: () => void) {}
  attach(stdout: Readable, stderr: Readable): void {
    stdout.on('error', () => this.fail('stream'));
    stderr.on('error', () => { this.warnings.interrupt(); this.fail('stream'); });
    stderr.on('end', () => this.warnings.finish());
    stderr.on('close', () => this.warnings.interrupt());
    stdout.on('end', () => { this.ended = true; this.changed(); });
    stdout.on('readable', () => this.read(stdout));
    stderr.on('data', (bytes: Buffer) => this.diagnostic(bytes));
    if (this.stopped) { stdout.destroy(); stderr.destroy(); }
  }
  private diagnostic(bytes: Buffer): void {
    if (this.stopped) return;
    this.diagnosticBytes += bytes.length;
    this.warnings.push(bytes);
    if (this.diagnosticBytes > this.input.maxDiagnosticBytes) { this.warnings.interrupt(); this.fail('diagnostic_limit'); }
  }
  private read(stdout: Readable): void {
    if (this.stopped || this.pending || !this.decision()) return;
    if (stdout.readableLength > RETAINED_LIMIT - CHUNK) { this.fail('stream'); return; }
    // A positive size still observes EOF; below the cap, deliver available bytes immediately.
    const size = Math.min(CHUNK, Math.max(1, stdout.readableLength));
    const bytes: Buffer | null = stdout.read(size) as Buffer | null;
    if (bytes === null) return;
    if (bytes.length > this.input.maxMetricStreamBytes - this.bytes) {
      this.fail('metric_limit'); return;
    }
    this.bytes += bytes.length;
    this.pending = true;
    // Catch synchronous callbacks too; raw errors and native bytes never enter observations.
    this.issued = Promise.resolve().then(async () => {
      if (!this.stopped && this.decision()) await this.input.sink(bytes, {
        signal: this.abort.signal, deadlineMs: this.input.attempt.mode === 'managed'
          ? this.input.attempt.deadlineMs : 0,
      });
    }).catch(() => this.fail('sink')).then(() => {
      this.pending = false;
      if (!this.stopped && this.decision()) this.read(stdout);
      this.changed();
    });
  }
  stop(): void { this.warnings.interrupt(); this.stopped = true; this.abort.abort(); }
  async close(): Promise<void> { await this.issued; }
}
