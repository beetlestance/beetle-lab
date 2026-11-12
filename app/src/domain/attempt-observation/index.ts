import type {AttemptSnapshot} from '@beetle/contracts';
import {immutableSnapshot} from '../namespaces/index.js';
import {captureIdentity,captureInput,captureSnapshot} from './input.js';
import {mergeAdmission} from './admission.js';
import {mergeSequence} from './sequence.js';
import type {AttemptObservationInput} from './types.js';
export type {AttemptIdentity,AttemptObservationInput} from './types.js';
export {MAX_ATTEMPT_OBSERVATION_BYTES} from './input.js';
/** Pure bounded observation merge; no event ACK, release or outcome authority. */
export function mergeAttemptSnapshot(input: AttemptObservationInput): Readonly<AttemptSnapshot> {
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
  return immutableSnapshot(snapshot);
}
