import { K6_DIAGNOSTIC_BYTES } from '@beetle/contracts/k6-diagnostics';
import { AttemptError } from './types.js';
import type { StagedHeaders } from '../input/index.js';
import type { ExecutionLimits } from '../execution/index.js';
const MiB = 1_048_576;
function enabledBytes(enabled: boolean, bytes: number): number {
  return enabled ? bytes : 0;
}
export interface OutputReservation {
  readonly control: number;
  readonly numeric: number;
  readonly warnings: number;
  readonly diagnostics: number;
  readonly reports: number;
  readonly result: number;
  readonly target: number;
  readonly targetHistory: number;
  readonly live: number;
  readonly build: number;
  readonly execution: number;
  readonly history: number;
  readonly historyCollect: number;
}
/** Logical retained/peak file bytes; parser work and physical disk blocks are separate. */
export function reserveOutput(total: number, targetSampling = false, liveMailbox = false): OutputReservation {
  if (!Number.isSafeInteger(total) || total < 1) throw new AttemptError('output_limit');
  const control = Math.min(64 * MiB, Math.max(65_536, Math.floor(total / 32)));
  const reports = 524_288;
  const warnings = 4096;
  const diagnostics = K6_DIAGNOSTIC_BYTES;
  const numeric = MiB - warnings - diagnostics;
  const result = 65_536;
  const target = enabledBytes(targetSampling, MiB);
  const targetHistory = enabledBytes(targetSampling, enabledBytes(liveMailbox, MiB));
  const live = enabledBytes(liveMailbox, Math.min(8 * MiB, Math.floor(total / 8)));
  const available =
    total - control - numeric - warnings - diagnostics - result - MiB - target - targetHistory - live - reports;
  if (!Number.isSafeInteger(available)) throw new AttemptError('output_limit');
  const history = Math.min(256 * MiB, Math.floor(available / 4));
  const build = Math.min(89 * MiB, available - history);
  if (history < 65_536 || build < 65_536) throw new AttemptError('output_limit');
  const execution = build + MiB + history + targetHistory;
  if (
    !Number.isSafeInteger(control + numeric + warnings + diagnostics + result + execution + target + live + reports) ||
    control + numeric + warnings + diagnostics + result + execution + target + live + reports > total
  )
    throw new AttemptError('output_limit');
  return Object.freeze({
    control,
    numeric,
    warnings,
    diagnostics,
    reports,
    result,
    target,
    targetHistory,
    live,
    build,
    execution,
    history,
    historyCollect: history,
  });
}

/** Admission ceilings cover phase-produced files; the shared journal has its own reservation. */
export function phaseReservation(reserved: OutputReservation, manifest: StagedHeaders['manifest']): OutputReservation {
  const prepare = manifest.phases.find((phase) => phase.phase === 'prepare')!.outputBytes;
  const collect = manifest.phases.find((phase) => phase.phase === 'collect')!.outputBytes;
  const execute = manifest.phases.find((phase) => phase.phase === 'execute')!.outputBytes;
  const live = Math.min(reserved.live, Math.floor(execute / 8));
  const history = Math.min(reserved.history, execute - MiB - live - reserved.targetHistory);
  const historyCollect =
    collect - MiB - reserved.numeric - reserved.warnings - reserved.diagnostics - reserved.target - reserved.reports;
  if (history < 65_536 || historyCollect < 65_536 || prepare < 1) throw new AttemptError('output_limit');
  const build = Math.min(reserved.build, prepare);
  return Object.freeze({
    ...reserved,
    live,
    build,
    history,
    historyCollect,
    execution: build + MiB + history + reserved.targetHistory,
  });
}

export function numericAllowance(reserved: OutputReservation, collect: number, summaryBytes: number): number {
  if (!Number.isSafeInteger(summaryBytes) || summaryBytes < 0 || summaryBytes > MiB)
    throw new AttemptError('output_limit');
  const remaining = collect - summaryBytes;
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw new AttemptError('output_limit');
  return Math.min(reserved.numeric, remaining);
}

/** Native execution receives only its carved allowance; parsing limits do not raise it. */
export function executionLimits(reserved: OutputReservation, collectMs: number): ExecutionLimits {
  return Object.freeze({
    maximumBuildBytes: reserved.build,
    reservedOutputBytes: reserved.execution,
    maximumMetricBytes: 68_719_476_736,
    maximumMetricRecords: 268_435_456,
    maximumDiagnosticBytes: 65_536,
    drainTimeoutMs: 1000,
    collectionTimeoutMs: Math.min(30_000, collectMs),
  });
}
