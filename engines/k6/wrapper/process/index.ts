import { ProcessActor } from './actor.js';
import { nodeSpawn, ownedGroup } from './ports.js';
import { validateProfile, validateRuntimeHost } from './profile.js';
import type { NativeProcess, NativeProcessOptions } from './types.js';

/** Trusted local composition only: consumes one staged, managed invocation without retry. */
export function createNativeProcess(input: NativeProcessOptions): NativeProcess {
  validateRuntimeHost();
  return new ProcessActor(input, { spawn: nodeSpawn, group: ownedGroup, validate: validateProfile });
}
export { ProcessBoundaryError } from './types.js';
export type { NativeProcess, NativeProcessOptions, ProcessObservation, ProcessCause, MetricDelivery } from './types.js';
