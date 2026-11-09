import type { AttemptSnapshot } from '@beetle/contracts';
import { immutableSnapshot } from '../namespaces/index.js';
import { captureIdentity, captureInput, captureSnapshot } from './input.js';
import { mergeAdmission } from './admission.js';
import { mergeSequence } from './sequence.js';
import type { AttemptObservation, AttemptObservationInput } from './types.js';
export type { AttemptIdentity, AttemptObservation, AttemptObservationInput } from './types.js';
export { MAX_ATTEMPT_OBSERVATION_BYTES } from './input.js';

function runState(value: AttemptSnapshot): AttemptObservation['runState'] {
  if (value.state === 'lost' || value.state === 'exited'
    || value.admission?.state === 'rejected' || value.admission?.state === 'released') return 'finalizing';
  return value.state === 'offered' ? 'dispatching' : 'active';
}
/** Pure bounded observation merge; no event ACK, release or outcome authority. */
export function mergeAttemptObservation(input: AttemptObservationInput): Readonly<AttemptObservation> {
  const captured = captureInput(input);
  const expected = captureIdentity(captured.expected);
  const incoming = captureSnapshot(captured.incoming, expected);
  const previous = captured.previous === null ? null : captureSnapshot(captured.previous, expected);
  const sequence = mergeSequence(previous, incoming);
  const admission = mergeAdmission(previous?.admission, incoming.admission);
  const snapshot: AttemptSnapshot = { ...sequence,
    cancelRequested: (previous?.cancelRequested ?? false) || incoming.cancelRequested,
    retainedStartSeq: Math.max(previous?.retainedStartSeq ?? 0, incoming.retainedStartSeq),
    ...(admission === undefined ? {} : { admission }) };
  return immutableSnapshot({ snapshot, runState: runState(snapshot) });
}
