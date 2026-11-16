import { runAttempt } from './attempt.js';
import { productionPorts } from './ports.js';
import type { StagedK6Options, StagedK6Receipt } from './types.js';
export type { StagedK6Options, StagedK6Receipt, AttemptReason, Quiescence } from './types.js';

/** Runs exactly one admitted staged attempt, awaiting all original owned cleanup. */
export function runStagedK6(options: StagedK6Options): Promise<StagedK6Receipt> {
  return runAttempt(options, productionPorts);
}
