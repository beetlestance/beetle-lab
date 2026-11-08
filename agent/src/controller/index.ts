import { createControlReader } from '../collection/control/index.js';
import { AttemptController } from './attempt.js';
import type { AttemptControllerOptions } from './types.js';
export { ControllerError } from './types.js';
export type { AttemptControllerOptions, AttemptProgress, ControllerBudget, ControllerReason } from './types.js';
export type { AttemptController } from './attempt.js';
/** Trusted composition only: the controller receives an already admitted, staged plan. */
export function createAttemptController(options: AttemptControllerOptions): AttemptController {
  return new AttemptController({ ...options, createReader: createControlReader });
}
