import type { RetirementIntent, JournalRetirements } from '../retirement-values/index.js';
import { ProducerRetirementError } from './types.js';
import type { ProducerBarrier, BarrierFacts } from './types.js';
const facts = new WeakMap<object, { readonly intent: RetirementIntent; readonly journal: JournalRetirements; readonly open: () => boolean }>();
export function mintBarrier(intent: RetirementIntent, journal: JournalRetirements, open: () => boolean): ProducerBarrier {
  const token = Object.freeze({}) as ProducerBarrier; facts.set(token, { intent, journal, open }); return token;
}
/** Observes local producer custody only; no serialized token or native absence inference. */
export function producerBarrierFacts(token: ProducerBarrier, journal?: JournalRetirements): BarrierFacts {
  const value = facts.get(token); if (!value || !value.open()) throw new ProducerRetirementError('closed');
  if (journal && value.journal !== journal) throw new ProducerRetirementError('conflict');
  return Object.freeze({ intent: value.intent });
}
