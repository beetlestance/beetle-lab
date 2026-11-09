import { encodeCanonicalJson } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import { requireRule } from '../namespaces/index.js';
import { MAX_ATTEMPT_OBSERVATION_BYTES } from './input.js';

const phases = ['validate', 'prepare', 'execute', 'collect', 'seal'] as const;
function equal(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left, MAX_ATTEMPT_OBSERVATION_BYTES) ===
    encodeCanonicalJson(right, MAX_ATTEMPT_OBSERVATION_BYTES);
}
function projection(value: AttemptSnapshot): object {
  return { state: value.state, phase: value.phase ?? null,
    result: value.result ?? null, exitEvidence: value.exitEvidence ?? null };
}
function forwardState(earlier: AttemptSnapshot['state'], later: AttemptSnapshot['state']): void {
  if (earlier !== 'offered') requireRule(later !== 'offered');
  if (earlier !== 'offered' && earlier !== 'admitted') requireRule(later !== 'admitted');
  if (earlier === 'stopping') requireRule(['stopping', 'lost', 'exited'].includes(later));
  if (earlier === 'lost') requireRule(later === 'lost' || later === 'exited');
  if (earlier === 'exited') requireRule(later === 'exited');
}
function forward(earlier: AttemptSnapshot, later: AttemptSnapshot): void {
  forwardState(earlier.state, later.state);
  if (earlier.phase !== undefined) {
    requireRule(later.phase !== undefined && phases.indexOf(later.phase) >= phases.indexOf(earlier.phase));
  }
  if (earlier.result !== undefined) requireRule(later.result !== undefined && equal(earlier.result, later.result));
  if (earlier.exitEvidence !== undefined) {
    requireRule(later.exitEvidence !== undefined && equal(earlier.exitEvidence, later.exitEvidence));
  }
}
/** Validates chronology even when the earlier original reply arrives last. */
export function mergeSequence(previous: AttemptSnapshot | null, incoming: AttemptSnapshot): AttemptSnapshot {
  if (previous === null) return incoming;
  if (previous.lastSeq === incoming.lastSeq) {
    requireRule(equal(projection(previous), projection(incoming))); return previous;
  }
  if (previous.lastSeq < incoming.lastSeq) { forward(previous, incoming); return incoming; }
  forward(incoming, previous); return previous;
}
