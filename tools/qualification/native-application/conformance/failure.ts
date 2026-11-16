import {record} from '../../resources/values.js';
const phases = ['startup', 'advanced-provision', 'idle', 'stream', 'final-drain', 'post-idle', 'executors', 'discovery-reached', 'discovery-exhausted',
 'slo', 'assertion', 'transport', 'inputs', 'methods-data-assertions', 'malformed-response', 'overflow', 'isolated-queue', 'settlement'];
/** Closed failure facts only; no raw exception, path, API body or claimed partial pass. */
export function publicFailure(input: unknown, id: string, revision: string) {
 const value = {id, status: 'failed', evidenceAvailable: false, phase: 'unavailable', cleanupVerified: false};
 try {
  const row = record(input);
  if ((row.sourceRevision ?? row.revision) !== revision || row.architecture !== 'amd64') return value;
  if (row.status !== 'passed' && row.status !== 'failed') return value;
  value.evidenceAvailable = true; value.cleanupVerified = row.cleanupVerified === true;
  if (typeof row.phase === 'string' && phases.includes(row.phase)) value.phase = row.phase;
 } catch { /* Missing or malformed evidence stays explicitly unavailable. */ }
 return value;
}
