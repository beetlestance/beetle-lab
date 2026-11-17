import type { AttemptSnapshot } from '@beetle/contracts';
import type { ErrorCode } from './protocol.js';
import { DEFAULT_QUOTA_BYTES } from './event-input.js';
import { validateFailureObserver } from './failure-diagnostic.js';
export class JournalError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly recovery?: AttemptSnapshot,
  ) {
    super(`Journal ${code}`);
    this.name = 'JournalError';
  }
}
export interface JournalOptions {
  readonly onFailure?: ((error: JournalError) => void) | undefined;
  path: string;
  /** Trusted packaging option: compiled worker entrypoint. */
  workerUrl?: URL;
  /** Includes the in-flight command; hard maximum 64. */
  queueLimit?: number;
  /** Per-attempt durable charge limit for new offers, 1024..64 MiB. */
  spoolQuotaBytes?: number;
}
function validateQuota(quota: number): void {
  if (!Number.isSafeInteger(quota) || quota < 1024 || quota > DEFAULT_QUOTA_BYTES)
    throw new JournalError('invalid_input');
}
export function validateOptions(options: JournalOptions): void {
  validateFailureObserver(options.onFailure, new JournalError('invalid_input'));
  const limit = options.queueLimit ?? 32;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new JournalError('invalid_input');
  const quota = options.spoolQuotaBytes ?? DEFAULT_QUOTA_BYTES;
  validateQuota(quota);
  const path = options.path;
  if (typeof path !== 'string' || !path || path === ':memory:' || path.length > 4096)
    throw new JournalError('invalid_input');
}
