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
    process.stderr.write(`${JSON.stringify({component: 'metadata', event: 'worker_failed', ...failure})}\n`);
  } catch { /* Logging failure must not interrupt fencing or worker termination. */ }
}
