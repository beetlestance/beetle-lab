import type { RuntimeCode } from './types.js';
export class RuntimeFailure extends Error {
  constructor(readonly code: RuntimeCode) { super(code); }
}
export function stop(code: RuntimeCode): never { throw new RuntimeFailure(code); }
