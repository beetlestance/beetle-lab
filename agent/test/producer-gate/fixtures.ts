import { ProducerGate } from '../../src/producer-gate/index.js';
import type { OutputSourceReaderOptions } from '../../src/output-transfer/index.js';
const gates = new WeakMap<OutputSourceReaderOptions['journal']['retirements'], ProducerGate>();
/** Synthetic namespace identity only: this fixture grants no native retirement capability. */
export function gateFor(journal: OutputSourceReaderOptions['journal'], namespaceIdentity = 'a'.repeat(64)): ProducerGate {
  const existing = gates.get(journal.retirements); if (existing) { if (existing.namespaceIdentity !== namespaceIdentity) throw new Error('Test gate namespace mismatch'); return existing; }
  const gate = new ProducerGate({ journal: journal.retirements, namespaceIdentity }); gates.set(journal.retirements, gate); return gate;
}
