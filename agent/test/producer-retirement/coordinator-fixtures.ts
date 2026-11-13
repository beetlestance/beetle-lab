import { vi } from 'vitest';
import type { JournalRetirements, RetirementIntent } from '../../src/retirement-values/index.js';
import { makeRetirementIntent } from '../../src/retirement-values/index.js';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { ProducerGate } from '../../src/producer-gate/index.js';
import { ProducerRetirement } from '../../src/producer-retirement/index.js';
import request from '../../../contracts/fixtures/valid/output-retirement-absence.json' with { type: 'json' };
export const original = captureOutputRetirementRequest(request);
export const metadata = (input: unknown): RetirementIntent => makeRetirementIntent({ request: captureOutputRetirementRequest(input),
  namespaceIdentity: 'a'.repeat(64), task: { state: 'none' } });
/** Protocol/ownership model only; this fixture supplies no native producer evidence. */
export function model(options: { budgetMs?: number; now?: () => number } = {}) {
  const intent = metadata(original); const records = new Map<string, RetirementIntent>();
  const port: JournalRetirements = {
    isOpen: vi.fn(async key => !records.has(key.attemptId)), preflight: vi.fn(async input => metadata(input)),
    begin: vi.fn(async input => { const record = metadata(input); records.set(record.request.attemptId, record); return record; }),
    read: vi.fn(async key => records.get(key.attemptId) ?? null), settleCarrier: vi.fn(async () => {}),
  };
  const gate = new ProducerGate({ journal: port, namespaceIdentity: intent.namespaceIdentity });
  const installation = { retireOutput: vi.fn(async () => {}) };
  const coordinator = new ProducerRetirement({ journal: port, gate, installation,
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }), ...(options.now ? { monotonicNow: options.now } : {}) });
  return { port, gate, installation, coordinator, intent, records, key: { organizationId: original.organizationId,
    workspaceId: original.workspaceId, attemptId: original.attemptId, generation: 1 } };
}
