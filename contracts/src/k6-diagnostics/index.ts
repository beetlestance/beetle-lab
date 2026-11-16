import {encodeCanonicalJson} from '../json.js';
import {validate} from '../validate.js';
import type {NativeDiagnosticArtifact} from '../generated/types.js';
export type K6Diagnostics = NativeDiagnosticArtifact;
export type NativeDiagnostics = Omit<K6Diagnostics, 'format' | 'version' | 'scope'>;
export type DiagnosticRecord = K6Diagnostics['records'][number];
export const K6_DIAGNOSTIC_RECORDS = 256;
export const K6_DIAGNOSTIC_BYTES = 32768;
export class K6DiagnosticError extends Error {constructor() {super('Diagnostic evidence rejected');}}
export function captureK6Diagnostics(input: unknown): K6Diagnostics {
  try {
    const checked = validate('NativeDiagnosticArtifact', JSON.parse(encodeCanonicalJson(input, K6_DIAGNOSTIC_BYTES - 1)));
    if (!checked.ok) throw new K6DiagnosticError();
    const value = checked.value;
    if (value.records.length !== Math.min(value.observedRecords, K6_DIAGNOSTIC_RECORDS)) throw new K6DiagnosticError();
    checkCounts(value); checkCoverage(value);
    for (const record of value.records) Object.freeze(record);
    Object.freeze(value.records); Object.freeze(value.scope); return Object.freeze(value);
  } catch {throw new K6DiagnosticError();}
}
function checkCounts(value: K6Diagnostics): void {
  let prior = 0; let redacted = 0; let invalid = 0;
  for (const record of value.records) {
    if (record.sequence !== prior + 1) throw new K6DiagnosticError(); prior = record.sequence;
    checkRecord(record);
    if (record.code === 'redacted') redacted++;
    if (record.code === 'invalid') invalid++;
  }
  checkTotals(value, redacted, invalid);
}
function checkRecord(record: DiagnosticRecord): void {
  if (record.code === 'invalid') {
    if (record.level !== 'unknown') throw new K6DiagnosticError();
  } else if (record.code === 'redacted') {
    if (record.level === 'unknown') throw new K6DiagnosticError();
  } else if (record.level !== 'warning') throw new K6DiagnosticError();
}
function checkTotals(value: K6Diagnostics, redacted: number, invalid: number): void {
  if (value.observedRecords !== value.records.length + value.droppedRecords || value.observedRecords > value.observedBytes) throw new K6DiagnosticError();
  if (value.redactedRecords + value.invalidSegments > value.observedRecords) throw new K6DiagnosticError();
  if (!value.droppedRecords && (redacted !== value.redactedRecords || invalid !== value.invalidSegments)) throw new K6DiagnosticError();
  if (redacted > value.redactedRecords || invalid > value.invalidSegments) throw new K6DiagnosticError();

}
function checkCoverage(value: K6Diagnostics): void {
  if (value.coverage === 'complete' && (value.invalidSegments > 0 || value.droppedRecords > 0)) throw new K6DiagnosticError();
}
export function decodeK6Diagnostics(bytes: Uint8Array): K6Diagnostics {
  if (!(bytes instanceof Uint8Array) || bytes.length > K6_DIAGNOSTIC_BYTES) throw new K6DiagnosticError();
  try {return captureK6Diagnostics(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));}
  catch {throw new K6DiagnosticError();}
}
/** Fixed product text only. Native payloads never become labels. */
export function diagnosticText(code: DiagnosticRecord['code']): string {
  switch (code) {
    case 'insufficient-vus': return 'Insufficient VUs reported; native details omitted.';
    case 'high-cardinality': return 'High metric cardinality reported; native details omitted.';
    case 'maximum-duration': return 'Maximum duration reported; native details omitted.';
    case 'redacted': return 'Native diagnostic details redacted.';
    case 'invalid': return 'Diagnostic segment could not be captured.';
  }
}
