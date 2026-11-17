import type { ErrorCode, Operation } from './protocol.js';

interface WorkerFailure {
  reason: string;
  code: ErrorCode;
  pending: number;
  operation: Operation['kind'] | null;
}
/** Fixed operational fields only; never include commands, SQL, paths or causes. */
export function reportWorkerFailure(failure: WorkerFailure): void {
  if (failure.reason === 'abort') return;
  try {
    process.stderr.write(`${JSON.stringify({ component: 'journal', event: 'worker_failed', ...failure })}\n`);
  } catch {
    /* Logging failure must not interrupt fencing or worker termination. */
  }
}

const failureCodes = new Set<unknown>([
  'invalid_input',
  'conflict',
  'not_found',
  'queue_full',
  'closed',
  'unavailable',
  'owned',
  'schema_newer',
  'stale_generation',
  'quota_exceeded',
  'cursor_expired',
  'expired_key',
  'recovery_required',
]);
export function captureFailureCode(code: unknown): ErrorCode {
  return failureCodes.has(code) ? (code as ErrorCode) : 'unavailable';
}

/** A faulty observer cannot prevent rejection/termination or print private errors. */
export function notifyWorkerFailure<T extends Error>(callback: ((error: T) => void) | undefined, error: T): void {
  try {
    callback?.(error);
  } catch {
    try {
      process.stderr.write('{"component":"journal","event":"failure_observer_failed"}\n');
    } catch {
      /* Preserve the original storage fence. */
    }
  }
}

export function validateFailureObserver(value: unknown, error: Error): void {
  if (value !== undefined && typeof value !== 'function') throw error;
}
