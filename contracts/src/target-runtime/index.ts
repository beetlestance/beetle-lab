import { encodeCanonicalJson } from '../json.js';
import { validate } from '../validate.js';
import { captureTargetGcWindow } from './gc-window.js';
import { schema } from '../generated/target-runtime-report.js';
import type { TargetMetricName, TargetRuntimeReport, TargetRuntimeSample } from './types.js';
export type {
  TargetMetricName,
  TargetRuntimePhase,
  TargetRuntimeReason,
  TargetRuntimeSample,
  TargetRuntimeReport,
  TargetRuntimeUnits,
} from './types.js';
export const TARGET_RUNTIME_REPORT_BYTES = 1048576;
export const targetMetricNames: readonly TargetMetricName[] = Object.freeze(
  Object.keys(schema.$defs.values.properties) as TargetMetricName[],
);
export class TargetRuntimeError extends Error {
  constructor(readonly code: 'invalid_report' | 'invalid_json' | 'body_limit') {
    super('Target runtime report rejected');
    this.name = 'TargetRuntimeError';
  }
}
/** Strict detached artifact boundary; missing values stay null and source keys retain their units. */
export function captureTargetRuntimeReport(input: unknown): TargetRuntimeReport {
  try {
    const detached: unknown = JSON.parse(encodeCanonicalJson(input, TARGET_RUNTIME_REPORT_BYTES));
    const result = validate('TargetRuntimeReport', detached);
    if (!result.ok) throw new TargetRuntimeError('invalid_report');
    const report = result.value;
    const unavailable = report.samples.filter((sample) => sample.status === 'unavailable').length;
    if (report.missed < unavailable || report.missed > unavailable + Number(report.limited))
      throw new TargetRuntimeError('invalid_report');
    report.samples.forEach(freezeSample);
    Object.freeze(report.samples);
    if (report.units) Object.freeze(report.units);
    if (report.requestSpan) {
      if (report.requestSpan.firstDispatchMs > report.requestSpan.lastCompletionMs)
        throw new TargetRuntimeError('invalid_report');
      Object.freeze(report.requestSpan);
    }
    return Object.freeze(report);
  } catch {
    throw new TargetRuntimeError('invalid_report');
  }
}
function freezeSample(sample: TargetRuntimeSample): void {
  if (sample.gcWindow) {
    const gcWindow = captureTargetGcWindow(sample.gcWindow);
    if (!gcWindow) throw new TargetRuntimeError('invalid_report');
    Object.freeze(sample.gcWindow.recentMs);
    Object.freeze(sample.gcWindow);
  }
  Object.freeze(sample.values);
  Object.freeze(sample);
}
export function decodeTargetRuntimeReport(bytes: Uint8Array): TargetRuntimeReport {
  if (!(bytes instanceof Uint8Array) || bytes.length > TARGET_RUNTIME_REPORT_BYTES)
    throw new TargetRuntimeError('body_limit');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new TargetRuntimeError('invalid_json');
  }
  return captureTargetRuntimeReport(value);
}
export function encodeTargetRuntimeReport(input: unknown): Uint8Array {
  return new TextEncoder().encode(encodeCanonicalJson(captureTargetRuntimeReport(input), TARGET_RUNTIME_REPORT_BYTES));
}

export { observationSummary, targetResetObserved, targetReading, observedMetricDecrease } from './summary.js';
export { captureTargetRuntimeUnits, targetUnitProjection, projectTargetReading } from './units.js';
export type { TargetUnit, TargetUnitProjection } from './units.js';

export { captureTargetGcWindow, targetGcPauseMaximum } from './gc-window.js';
