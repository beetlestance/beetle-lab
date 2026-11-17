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

/** A faulty observer cannot prevent rejection/termination or print private errors. */
export function notifyWorkerFailure<T extends Error>(callback:((error:T)=>void)|undefined,error:T):void {
  try{callback?.(error);}catch{try{process.stderr.write('{"component":"metadata","event":"failure_observer_failed"}\n');}catch{ /* Preserve the original storage fence. */ }}
}

export function validateFailureObserver(value:unknown,error:Error):void {
  if(value!==undefined&&typeof value!=='function')throw error;
}
