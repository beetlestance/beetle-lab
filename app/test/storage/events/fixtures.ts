import { afterEach } from 'vitest';
import { claimsFixture } from '../dispatch-claim-fixtures.js';
import { acknowledge, reserveAndMark } from '../execution-foundation-fixtures.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { observation, settingsFixture } from '../fixture.js';
import { prepareEventBatch } from '../../../src/domain/events/index.js';
import type { AgentEvent, EventBatch } from '@beetle/contracts';
import type { EventBinding, EventIngestRequest } from '../../../src/ports/events.js';
import batch from '../../../../contracts/fixtures/valid/events.json' with { type: 'json' };
export function event(binding: EventBinding, seq: number): AgentEvent {
  const template = batch.events.find(value => value.kind === 'runtime.started')!;
  const identity = eventIdentity(binding);
  return { ...template, ...identity, seq, payload: { runtimeId: 'r' } } as AgentEvent;
}
export function request(binding: EventBinding, after = 0, count = 1): EventIngestRequest & { batch: EventBatch } {
  const identity = eventIdentity(binding);
  return { binding, after, batch: { protocolVersion: '1.0', ...identity, retainedStartSeq: 1,
    nextCursor: after + count, events: Array.from({ length: count }, (_, index) => event(binding, after + index + 1)) } };
}
export function ack(binding: EventBinding, acknowledgedSeq: number) {
  const identity = eventIdentity(binding);
  return { protocolVersion: '1.0' as const, ...identity, acknowledgedSeq };
}

const handles = new Set<ReturnType<typeof claimsFixture>>();
afterEach(() => { for (const f of handles) f.db.close(); handles.clear(); });
export function eventFixture(output = 10000) {
  const f = claimsFixture(); handles.add(f);
  f.policy(values => { values.pool.outputBytes = 100000; values.perRunCeilings.outputBytes = 100000; });
  const runtime = observation(settingsFixture().runtime); runtime.ceilings.pool.outputBytes = 100000;
  runtime.ceilings.perRun.outputBytes = 100000; runtime.ceilings.pool.storageBytes = 400000;
  f.store.execute({ kind: 'runtime', runtime });
  const key = f.add(70, 'parallel', 100, output);
  transaction(f.db, () => { reserveAndMark(f.db, key); acknowledge(f.db, key); });
  const binding: EventBinding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  return { ...f, binding, event: () => prepareEventBatch(request(binding)).records[0]! };
}

export function eventIdentity(binding: EventBinding) {
  const a = binding.key.attempt;
  return { organizationId: a.organizationId, workspaceId: a.workspaceId, attemptId: a.attemptId, generation: a.generation };
}
