import { memoryFacts } from '../bounded-load/memory.js';
import { publicParityFailure } from '../parity/failure.js';
import { record } from '../../resources/values.js';
import { publicProvisionDiagnosis } from '../soak/provision.js';
import { publicShortFailure } from '../load/failure.js';
const phases = [
  'startup',
  'advanced-provision',
  'idle',
  'stream',
  'final-drain',
  'post-idle',
  'executors',
  'discovery-reached',
  'discovery-exhausted',
  'loaded',
  'custody',
  'final',
  'slo',
  'assertion',
  'transport',
  'inputs',
  'methods-data-assertions',
  'malformed-response',
  'overflow',
  'isolated-queue',
  'settlement',
];
function partialMemory(input: unknown) {
  try {
    return memoryFacts(input);
  } catch {
    return null;
  }
}
function resultsOf(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? record(input) : {};
}
function sourceBound(row: Record<string, unknown>, revision: string) {
  return (
    (row.sourceRevision ?? row.revision) === revision &&
    row.architecture === 'amd64' &&
    (row.status === 'passed' || row.status === 'failed' || row.status === 'target-missed')
  );
}
/** Closed failure facts only; no raw exception, path, API body or claimed partial pass. */
export function publicFailure(input: unknown, id: string, revision: string) {
  const value = {
    id,
    status: 'failed',
    evidenceAvailable: false,
    phase: 'unavailable',
    cleanupVerified: false,
    advancedStage: 'unavailable',
    memory: null as ReturnType<typeof memoryFacts> | null,
    diagnosis: null as ReturnType<typeof publicParityFailure> | null,
    advancedFailure: null as ReturnType<typeof publicProvisionDiagnosis>,
    controlFailure: null as ReturnType<typeof publicShortFailure> | null,
  };
  try {
    const row = record(input);
    if (!sourceBound(row, revision)) return value;
    const results = resultsOf(row.results);
    if (id === 'repeated-memory') value.memory = partialMemory(results.trials);
    if (id.startsWith('engine-')) value.diagnosis = publicParityFailure(row.failure);
    if (id === 'control-rss') value.controlFailure = publicShortFailure(row, revision);
    if (
      typeof results.advancedStage === 'string' &&
      ['bootstrap', 'write-request', 'socket-group', 'provision', 'compose-override'].includes(results.advancedStage)
    )
      value.advancedStage = results.advancedStage;
    value.advancedFailure = publicProvisionDiagnosis(results.advancedFailure);
    value.evidenceAvailable = true;
    value.cleanupVerified = row.cleanupVerified === true;
    if (typeof row.phase === 'string' && phases.includes(row.phase)) value.phase = row.phase;
  } catch {
    /* Missing or malformed evidence stays explicitly unavailable. */
  }
  return value;
}
