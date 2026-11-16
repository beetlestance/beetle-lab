import { Loader } from './loader.js';
import type { InputOperation, OpenStagedOptions, StagedInput } from './types.js';
export type * from './types.js';
export type { SecretBindings } from './secrets.js';
export { matchSecretReferences, prepareSecretReferences } from './secrets.js';

/** Private Node boundary. Roots/engine pins come from trusted read-only image packaging. */
export function openStagedInput(options: OpenStagedOptions): InputOperation<StagedInput> {
  const snapshot = Object.freeze({ ...options, installed: Object.freeze({ ...options.installed }),
    ...(options.exportAssignment ? {exportAssignment:Object.freeze({...options.exportAssignment})} : {}),
    ...(options.expected ? { expected: Object.freeze({ ...options.expected }) } : {}) });
  return new Loader(snapshot).open();
}
