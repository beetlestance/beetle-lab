import type { RetirementIntent } from '../retirement-values/index.js';
import { ProducerRetirementError } from './types.js';
import type { ProducerBarrier, BarrierFacts } from './types.js';
const facts = new WeakMap<object, { readonly intent: RetirementIntent; readonly open: () => boolean }>();
export function mintBarrier(intent: RetirementIntent, open: () => boolean): ProducerBarrier {
  const token = Object.freeze({}) as ProducerBarrier; facts.set(token, { intent, open }); return token;
}
/** Observes local producer custody only; no serialized token or native absence inference. */
export function producerBarrierFacts(token: ProducerBarrier): BarrierFacts {
  const value = facts.get(token); if (!value || !value.open()) throw new ProducerRetirementError('closed');
  return Object.freeze({ intent: value.intent });
}
