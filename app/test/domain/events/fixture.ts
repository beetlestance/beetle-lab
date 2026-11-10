import type { EventBatch } from '@beetle/contracts';
import type { EventBinding } from '../../../src/domain/events/index.js';
import batch from '../../../../contracts/fixtures/valid/events.json' with { type: 'json' };
import original from '../../../../contracts/fixtures/valid/offer.json' with { type: 'json' };

export const otherId = '00000000-0000-4000-8000-000000000099';
export function binding(): EventBinding {
  return { key: { runId: otherId, attempt: { attemptId: original.attemptId,
    organizationId: original.organizationId, workspaceId: original.workspaceId,
    generation: 1, intentDigest: original.intentDigest } },
  journalAuthority: '33333333-3333-4333-8333-333333333333' };
}
export function events(): EventBatch { return structuredClone(batch) as EventBatch; }
export function repeated(count: number): EventBatch {
  const value = events();
  value.events = Array.from({ length: count }, (_, index) => ({ ...structuredClone(value.events[0]!), seq: index + 1 }));
  value.nextCursor = count;
  return value;
}
