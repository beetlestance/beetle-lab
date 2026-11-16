import { producerBarrierFacts } from '../producer-retirement/index.js';
import type { ProducerBarrier } from '../producer-retirement/index.js';
import type { JournalRetirements } from '../retirement-values/index.js';
import { RuntimeRetirementError } from './types.js';
import type { RuntimeAbsent, RuntimeAbsentFacts } from './types.js';
const facts = new WeakMap<object, { readonly facts: RuntimeAbsentFacts; readonly producer: ProducerBarrier;
  readonly journal: JournalRetirements; readonly open: () => boolean }>();
export function mintRuntimeAbsent(input: { facts: RuntimeAbsentFacts; producer: ProducerBarrier; journal: JournalRetirements;
  open(): boolean }): RuntimeAbsent {
  const token = Object.freeze({}) as RuntimeAbsent;
  facts.set(token, { ...input, facts: Object.freeze({ ...input.facts, runtime: Object.freeze(input.facts.runtime) }) }); return token;
}
export function runtimeAbsentFacts(token: RuntimeAbsent, journal: JournalRetirements): RuntimeAbsentFacts {
  const value = facts.get(token);
  if (!value || !value.open()) throw new RuntimeRetirementError('closed');
  if (value.journal !== journal) throw new RuntimeRetirementError('conflict');
  producerBarrierFacts(value.producer, journal); return value.facts;
}
