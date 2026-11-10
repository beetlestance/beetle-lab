import { vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import type { AckReceipt, AgentEvent, ClientResult, EventBatch, ProtocolError } from '@beetle/contracts';
import { prepareEventBatch } from '../../src/domain/events/index.js';
import type { EventBinding } from '../../src/domain/events/index.js';
import type { EventCursorState, EventCustodyStore } from '../../src/ports/events.js';
import type { RunnerAttemptClient, RunnerGateway } from '../../src/ports/runner.js';
import { collectEvents } from '../../src/adapters/outbound/runner/events/index.js';
import original from '../../../contracts/fixtures/valid/events.json' with { type: 'json' };

export const otherId = '00000000-0000-4000-8000-000000000099';
export function binding(): EventBinding {
  return { key: { runId: otherId, attempt: { attemptId: original.attemptId,
    organizationId: original.organizationId, workspaceId: original.workspaceId,
    generation: 1, intentDigest: 'a'.repeat(64) } },
  journalAuthority: '33333333-3333-4333-8333-333333333333' };
}
export function events(count = 1, after = 0): EventBatch {
  return { ...structuredClone(original) as EventBatch,
    events: Array.from({ length: count }, (_, index) => ({ ...structuredClone(original.events[0]!) as EventBatch['events'][number],
      seq: after + index + 1 })), nextCursor: after + count, retainedStartSeq: 1 };
}
/** Synthetic result records with explicit byte budgets, independent of the transport. */
export function sizedEvent(bytes: number, seq = 1): AgentEvent {
  const source = (structuredClone(original) as EventBatch).events.find(event => event.kind === 'engine.result')!;
  source.seq = seq;
  source.payload.artifacts = Array.from({ length: 100 }, (_, index) => ({ ...source.payload.artifacts[0]!,
    artifactId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, relativePath: String(index) }));
  let remaining = bytes - Buffer.byteLength(encodeJson(source, 262_144));
  if (remaining < 0) throw new Error('Synthetic record budget too small');
  for (const artifact of source.payload.artifacts) {
    const extra = Math.min(remaining, 512 - artifact.relativePath.length);
    artifact.relativePath += 'x'.repeat(extra); remaining -= extra;
  }
  if (remaining !== 0) throw new Error('Synthetic record budget too large');
  return source;
}
export function sizedBatch(bytes: number): EventBatch {
  const source = { ...events(0), nextCursor: 4 };
  const payload = bytes - Buffer.byteLength(encodeJson(source, 262_144)) - 3;
  const perEvent = Math.floor(payload / 4);
  source.events = Array.from({ length: 4 }, (_, index) => sizedEvent(perEvent + (index === 3 ? payload % 4 : 0), index + 1));
  return source;
}
export function state(patch: Partial<EventCursorState> = {}): EventCursorState {
  const durableThrough = patch.durableThrough ?? 0;
  const eventCount = patch.eventCount ?? durableThrough;
  return { binding: binding(), durableThrough, ackConfirmedThrough: 0, coverage: 'contiguous',
    blockedReason: null, retainedStartSeq: null, retainedBytes: eventCount * 1000, eventCount,
    ...patch };
}
export function receipt(through = 1): AckReceipt {
  const { organizationId, workspaceId, attemptId, generation } = binding().key.attempt;
  return { protocolVersion: '1.0', organizationId, workspaceId, attemptId, generation, acknowledgedSeq: through };
}
export function negative(patch: Partial<ProtocolError> = {}, status = 404): ClientResult<never> {
  const { organizationId, workspaceId, attemptId } = binding().key.attempt;
  return { ok: false, error: { kind: 'protocol', status, protocol: { protocolVersion: '1.0',
    organizationId, workspaceId, attemptId, reason: 'attempt_not_found', retry: 'never', issues: [], ...patch } } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flush(): Promise<void> { for (let i = 0; i < 20; i++) await Promise.resolve(); }
export function fixture() {
  const held = { current: state(), stopped: false };
  const calls: string[] = [];
  const controller = new AbortController();
  const store = {
    scan: vi.fn<EventCustodyStore['scan']>(),
    load: vi.fn<EventCustodyStore['load']>(async () => { calls.push('load'); return held.current; }),
    ingest: vi.fn<EventCustodyStore['ingest']>(async request => {
      calls.push('ingest');
      const batch = prepareEventBatch(request);
      const suffix = batch.records.filter(record => record.seq > held.current.durableThrough);
      held.current = { ...held.current, durableThrough: Math.max(batch.nextCursor, held.current.durableThrough),
        eventCount: held.current.eventCount + suffix.length,
        retainedBytes: held.current.retainedBytes + suffix.reduce((sum, record) => sum + record.chargedBytes, 0) };
      return { state: held.current, ackThrough: held.current.durableThrough, inserted: suffix.length };
    }),
    confirmAck: vi.fn<EventCustodyStore['confirmAck']>(async request => {
      calls.push('confirm');
      held.current = { ...held.current, ackConfirmedThrough: (request.receipt as AckReceipt).acknowledgedSeq };
      return held.current;
    }),
    recordProblem: vi.fn<EventCustodyStore['recordProblem']>(async request => {
      calls.push('problem');
      held.current = { ...held.current, blockedReason: request.kind,
        coverage: request.kind === 'cursor_expired' ? 'partial' : 'contiguous',
        retainedStartSeq: request.retainedStartSeq ?? null };
      return held.current;
    }),
  };
  const client = {
    offer: vi.fn<RunnerAttemptClient['offer']>(), snapshot: vi.fn<RunnerAttemptClient['snapshot']>(),
    cancel: vi.fn<RunnerAttemptClient['cancel']>(), cancelOriginal: vi.fn<RunnerAttemptClient['cancelOriginal']>(),
    events: vi.fn<RunnerAttemptClient['events']>(async () => { calls.push('GET'); return { ok: true, value: events() }; }),
    ack: vi.fn<RunnerAttemptClient['ack']>(async request => { calls.push('ACK'); return { ok: true, value: receipt(request.throughSeq) }; }),
  };
  const attempt = vi.fn<RunnerGateway['attempt']>(() => client);
  const operations = { store, attempt, signal: controller.signal, stopped: () => held.stopped };
  return { held, calls, store, client, attempt, operations,
    stop() { held.stopped = true; controller.abort(); },
    collect: (selected = binding()) => collectEvents(operations, selected) };
}
