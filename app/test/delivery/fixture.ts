import { vi } from 'vitest';
import type { AttemptSnapshot, ClientResult, Offer, ProtocolError } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { DispatchCandidate, DispatchClaim, DispatchKey, DispatchPage, DispatchScan, DispatchStore } from '../../src/ports/dispatch.js';
import type { RunnerAttemptClient, RunnerGateway } from '../../src/ports/runner.js';
import type { DeliveryRuntimeOptions } from '../../src/ports/delivery.js';
import { startDeliveryRuntime } from '../../src/adapters/outbound/runner/delivery/index.js';
import offerFixture from '../../../contracts/fixtures/valid/offer.json' with { type: 'json' };
import snapshotFixture from '../../../contracts/fixtures/valid/snapshot.json' with { type: 'json' };
import runFixture from '../../../contracts/fixtures/api/valid/run.json' with { type: 'json' };

export const authority = '33333333-3333-4333-8333-333333333333';
export const otherId = '00000000-0000-4000-8000-000000000099';
export function keyFor(order = 1): DispatchKey {
  return { runId: runFixture.id, attempt: { organizationId: offerFixture.organizationId,
    workspaceId: offerFixture.workspaceId, attemptId: `00000000-0000-4000-8000-${String(order + 2).padStart(12, '0')}`,
    generation: 1, intentDigest: offerFixture.intentDigest } };
}
export function candidate(order = 1, ready = true): DispatchCandidate {
  return { key: keyFor(order), order, after: `after-${order}`, eligibility: ready
    ? { kind: 'ready' } : { kind: 'blocked', reason: 'capacity_unknown' } };
}
export function snapshot(key = keyFor()): AttemptSnapshot { return { ...structuredClone(snapshotFixture) as AttemptSnapshot, ...key.attempt }; }
export function runValue(key = keyFor()): Run { return { ...structuredClone(runFixture) as Run, activeAttemptId: key.attempt.attemptId }; }
export function offer(key = keyFor()): Offer {
  const { organizationId, workspaceId, attemptId, intentDigest } = key.attempt;
  const identity = { organizationId, workspaceId, attemptId, intentDigest };
  return { ...structuredClone(offerFixture) as Offer, ...identity };
}
export const positive = (key = keyFor()): { ok: true; value: AttemptSnapshot } => ({ ok: true, value: snapshot(key) });
export function missing(key = keyFor()): ClientResult<AttemptSnapshot> {
  return { ok: false, error: { kind: 'protocol', status: 404, protocol: { protocolVersion: '1.0',
    organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId,
    attemptId: key.attempt.attemptId, reason: 'attempt_not_found', retry: 'never', issues: [] } } };
}
export function protocol(value: Partial<ProtocolError>, status = 404): ClientResult<AttemptSnapshot> {
  const result = missing();
  if (result.ok) throw new Error('Invalid fixture');
  return { ok: false, error: { ...result.error, status, protocol: { ...result.error.protocol!, ...value } } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flush(): Promise<void> { for (let i = 0; i < 20; i++) await Promise.resolve(); }
export async function tick(ms = 0): Promise<void> { await vi.advanceTimersByTimeAsync(ms); await flush(); }
export function fixture() {
  const calls: string[] = [];
  const key = keyFor();
  const run = runValue();
  const client = {
    offer: vi.fn<RunnerAttemptClient['offer']>(async () => { calls.push('PUT'); return positive(); }),
    cancelOriginal: vi.fn<RunnerAttemptClient['cancelOriginal']>(async () => { calls.push('cancelOriginal'); return positive(); }),
    snapshot: vi.fn<RunnerAttemptClient['snapshot']>(async () => { calls.push('GET'); return missing(); }),
    cancel: vi.fn<RunnerAttemptClient['cancel']>(async () => { calls.push('cancel'); return positive(); }),
    events: vi.fn<RunnerAttemptClient['events']>(), ack: vi.fn<RunnerAttemptClient['ack']>(),
  };
  const store = {
    scan: vi.fn<DispatchStore['scan']>(async () => ({ items: [candidate()], nextCursor: null })),
    readOffer: vi.fn<DispatchStore['readOffer']>(async selected => { calls.push('read'); return { key: selected, offer: offer(selected) }; }),
    claim: vi.fn<DispatchStore['claim']>(async selected => { calls.push('claim'); return { kind: 'claimed', key: selected, journalAuthority: authority }; }),
    observe: vi.fn<DispatchStore['observe']>(async request => { calls.push('observe'); return {
      run: runValue(request.key), snapshot: request.snapshot as AttemptSnapshot, executionCharged: true, runChanged: false }; }),
  };
  const getRun = vi.fn(async () => { calls.push('run'); return structuredClone(run); });
  const gateway = { attempt: vi.fn<RunnerGateway['attempt']>(() => client),
    capabilities: vi.fn<RunnerGateway['capabilities']>(), close: vi.fn<RunnerGateway['close']>() };
  const onFailure = vi.fn<DeliveryRuntimeOptions['onFailure']>(async () => undefined);
  const options = { store, runs: { getRun }, gateway, onFailure, intervalMs: 25 };
  return { key, run, client, store, getRun, gateway, onFailure, options, calls,
    start: () => startDeliveryRuntime(options),
    claim: (kind: Exclude<DispatchClaim['kind'], 'blocked'>) => store.claim.mockImplementation(async () => {
      calls.push('claim');
      return kind === 'acknowledged' ? { kind, journalAuthority: authority } : { kind, key, journalAuthority: authority };
    }) };
}

/** Captured upper order cursor fixture, independent of the runtime traversal. */
export function queueScanner(items: DispatchCandidate[]) {
  return async (query: DispatchScan): Promise<DispatchPage> => {
    if (query.lane === 'reconcile') return { items: [], nextCursor: null };
    const [after, upper] = query.cursor ? query.cursor.split(':').map(Number) : [0, Math.max(0, ...items.map(item => item.order))];
    const visible = items.filter(item => item.order > after! && item.order <= upper!);
    const page = visible.slice(0, query.limit).map(item => ({ ...item, after: `${item.order}:${upper}` }));
    return { items: page, nextCursor: visible.length > page.length ? page.at(-1)!.after : null };
  };
}
