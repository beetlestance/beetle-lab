import { buildRuntimeScript } from '../../build/index.js';
import { createNativeProcess } from '../process/index.js';
import { readK6Summary } from '../collection/index.js';

/** Private composition seam; never accepted in staged or public launch options. */
export interface ExecutionPorts {
  readonly build: typeof buildRuntimeScript;
  readonly native: typeof createNativeProcess;
  readonly summary: typeof readK6Summary;
}
export const productionPorts: ExecutionPorts = Object.freeze({ build: buildRuntimeScript,
  native: createNativeProcess, summary: readK6Summary });
