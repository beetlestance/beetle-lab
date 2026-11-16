import type {AttemptSnapshot} from '@beetle/contracts';
import {immutableSnapshot,requireRule} from '../namespaces/index.js';
import {mergeAttemptSnapshot} from '../attempt-observation/index.js';
import type {AttemptObservation,AttemptObservationInput} from './types.js';
export type {AttemptIdentity,AttemptObservationInput,AttemptObservation} from './types.js';
export {MAX_ATTEMPT_OBSERVATION_BYTES} from '../attempt-observation/index.js';

function runState(value: AttemptSnapshot): AttemptObservation['runState'] {
  if (value.state === 'lost' || value.state === 'exited'
    || value.admission?.state === 'rejected' || value.admission?.state === 'released') return 'finalizing';
  return value.state === 'offered' ? 'dispatching' : 'active';
}
/** Performance projection only; export jobs cannot manufacture a Run report. */
export function mergeAttemptObservation(input:AttemptObservationInput):Readonly<AttemptObservation>{
 const snapshot=mergeAttemptSnapshot(input);requireRule(snapshot.exportResult===undefined);
 return immutableSnapshot({snapshot,runState:runState(snapshot)});
}
