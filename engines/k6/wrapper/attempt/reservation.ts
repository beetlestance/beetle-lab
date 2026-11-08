import { AttemptError } from './types.js';
import type { StagedHeaders } from '../input/index.js';
const MiB = 1_048_576;
export interface OutputReservation {
  readonly control: number; readonly numeric: number; readonly result: number;
  readonly build: number; readonly execution: number;
}
/** Logical retained/peak file bytes; parser work and physical disk blocks are separate. */
export function reserveOutput(total: number): OutputReservation {
  if (!Number.isSafeInteger(total) || total < 1) throw new AttemptError('output_limit');
  const control = Math.min(64 * MiB, Math.max(65_536, Math.floor(total / 32)));
  const numeric = MiB; const result = 65_536;
  const available = total - control - numeric - result - MiB;
  if (!Number.isSafeInteger(available) || available < 65_536) throw new AttemptError('output_limit');
  const build = Math.min(89 * MiB, available);
  const execution = build + MiB;
  if (!Number.isSafeInteger(control + numeric + result + execution)
    || control + numeric + result + execution > total) throw new AttemptError('output_limit');
  return Object.freeze({ control, numeric, result, build, execution });
}

/** Admission ceilings cover phase-produced files; the shared journal has its own reservation. */
export function phaseReservation(reserved: OutputReservation, manifest: StagedHeaders['manifest']): OutputReservation {
  const prepare = manifest.phases.find(phase => phase.phase === 'prepare')!.outputBytes;
  const collect = manifest.phases.find(phase => phase.phase === 'collect')!.outputBytes;
  if (collect < MiB || prepare < 1) throw new AttemptError('output_limit');
  const build = Math.min(reserved.build, prepare);
  return Object.freeze({ ...reserved, build, execution: build + MiB });
}

export function numericAllowance(reserved: OutputReservation, collect: number, summaryBytes: number): number {
  if (!Number.isSafeInteger(summaryBytes) || summaryBytes < 0 || summaryBytes > MiB) throw new AttemptError('output_limit');
  const remaining = collect - summaryBytes;
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw new AttemptError('output_limit');
  return Math.min(reserved.numeric, remaining);
}
