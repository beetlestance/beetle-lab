import type { AttemptSnapshot } from '@beetle/contracts';
import type { ErrorCode } from './protocol.js';
export class Failure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly recovery?: AttemptSnapshot,
  ) {
    super(code);
  }
}
