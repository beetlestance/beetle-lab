import { AttemptError } from './types.js';
import type { StagedHeaders } from '../input/index.js';
const MiB = 1_048_576;
export interface OutputReservation {
  readonly control: number; readonly numeric: number; readonly result: number;
  readonly build: number; readonly execution: number; readonly history: number; readonly historyCollect: number;
}
/** Logical retained/peak file bytes; parser work and physical disk blocks are separate. */
export function reserveOutput(total: number): OutputReservation {
  if (!Number.isSafeInteger(total) || total < 1) throw new AttemptError('output_limit');
  const control = Math.min(64 * MiB, Math.max(65_536, Math.floor(total / 32)));
  const numeric = MiB; const result = 65_536;
  const available = total - control - numeric - result - MiB;
  if (!Number.isSafeInteger(available)) throw new AttemptError('output_limit');
  const history = Math.min(256 * MiB, Math.floor(available / 4));
  const build = Math.min(89 * MiB, available - history);
  if (history < 65_536 || build < 65_536) throw new AttemptError('output_limit');
  const execution = build + MiB + history;
  if (!Number.isSafeInteger(control + numeric + result + execution)
    || control + numeric + result + execution > total) throw new AttemptError('output_limit');
  return Object.freeze({ control, numeric, result, build, execution, history, historyCollect: history });
}

/** Admission ceilings cover phase-produced files; the shared journal has its own reservation. */
export function phaseReservation(reserved: OutputReservation, manifest: StagedHeaders['manifest']): OutputReservation {
  const prepare = manifest.phases.find(phase => phase.phase === 'prepare')!.outputBytes;
  const collect = manifest.phases.find(phase => phase.phase === 'collect')!.outputBytes;
  const execute = manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes;
  const history = Math.min(reserved.history, execute - MiB);
  const historyCollect = collect - MiB - reserved.numeric;
  if (history < 65_536 || historyCollect < 65_536 || prepare < 1) throw new AttemptError('output_limit');
  const build = Math.min(reserved.build, prepare);
  return Object.freeze({ ...reserved, build, history, historyCollect, execution: build + MiB + history });
}

export function numericAllowance(reserved: OutputReservation, collect: number, summaryBytes: number): number {
  if (!Number.isSafeInteger(summaryBytes) || summaryBytes < 0 || summaryBytes > MiB) throw new AttemptError('output_limit');
  const remaining = collect - summaryBytes;
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw new AttemptError('output_limit');
  return Math.min(reserved.numeric, remaining);
}
