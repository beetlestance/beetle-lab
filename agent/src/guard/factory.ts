import { scanOutput } from '../staging/index.js';
import { OutputGuardService } from './service.js';
import { optionsCopy } from './bounds.js';
import type { OutputGuard, OutputGuardOptions } from './types.js';

/** Public construction always binds the real bounded filesystem scanner. */
export function createOutputGuard(options: OutputGuardOptions): OutputGuard {
  const captured = optionsCopy(options);
  return new OutputGuardService(captured, (request, operation) => scanOutput(captured.root, request, operation));
}
