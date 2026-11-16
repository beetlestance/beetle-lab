import {K6_DIAGNOSTIC_RECORDS} from '@beetle/contracts/k6-diagnostics';
import type {DiagnosticRecord, NativeDiagnostics} from '@beetle/contracts/k6-diagnostics';
/** Retains only fixed enums, never a native string or parser exception. */
export class DiagnosticHistory {
  private records: DiagnosticRecord[] = [];
  private observed = 0;
  private invalid = 0;
  private redacted = 0;
  private bytes = 0;
  private complete = false;
  private interrupted = false;
  countBytes(count: number): void {this.bytes += count;}
  record(level: DiagnosticRecord['level'], code: DiagnosticRecord['code']): void {
    const sequence = ++this.observed;
    if (code === 'invalid') this.invalid++;
    if (code === 'redacted') this.redacted++;
    if (this.records.length < K6_DIAGNOSTIC_RECORDS) this.records.push(Object.freeze({sequence, level, code}));
  }
  finish(partial: boolean): void {this.complete = true; this.interrupted ||= partial;}
  snapshot(): NativeDiagnostics {
    const droppedRecords = this.observed - this.records.length;
    const records = [...this.records]; Object.freeze(records);
    return Object.freeze({coverage: this.complete && !this.interrupted && !this.invalid && !droppedRecords ? 'complete' : 'partial',
      observedBytes: this.bytes, observedRecords: this.observed, invalidSegments: this.invalid,
      redactedRecords: this.redacted, droppedRecords, records});
  }
}
