import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttemptSnapshot, ClientResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import { authority, fixture, missing, otherId, positive, protocol, tick } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('original delivery and physical authority', () => {
  it('reads then claims and checks Run before delivering exactly the original', async () => {
    const f = fixture(); const runtime = f.start();
    await tick(); await runtime.close();
    expect(f.calls).toEqual(['read', 'claim', 'run', 'PUT', 'observe', 'run']);
    expect(f.client.offer).toHaveBeenCalledTimes(1);
    expect(f.client.offer.mock.calls[0]![0]).toEqual((await f.store.readOffer(f.key)).offer);
    expect(f.gateway.attempt).toHaveBeenCalledWith({ ...f.key.attempt, journalAuthority: authority });
    expect(f.store.observe.mock.calls[0]![0].journalAuthority).toBe(authority);
    expect(f.client.ack).not.toHaveBeenCalled(); expect(f.client.events).not.toHaveBeenCalled();
    expect(f.gateway.close).not.toHaveBeenCalled();
  });
  it.each(['queued', 'reconcile'] as const)('GETs before same-original PUT on %s replay', async lane => {
    const f = fixture(); f.claim('replay');
    f.store.scan.mockImplementation(async query => ({ items: query.lane === lane ? [{ key: f.key, order: 1,
      after: 'cursor', eligibility: { kind: 'ready' } }] : [], nextCursor: null }));
    const runtime = f.start(); await tick(lane === 'queued' ? 0 : 25); await runtime.close();
    expect(f.calls).toEqual(['read', 'claim', 'GET', 'run', 'PUT', 'observe', 'run']);
    expect(f.gateway.capabilities).not.toHaveBeenCalled();
  });
  it('observes an existing replay without PUT during changed live capabilities', async () => {
    const f = fixture(); f.claim('replay'); f.client.snapshot.mockResolvedValue(positive());
    f.gateway.capabilities.mockRejectedValue(new Error('changed live caps'));
    const runtime = f.start(); await tick(); await runtime.close();
    expect(f.client.offer).not.toHaveBeenCalled();
    expect(f.gateway.attempt).toHaveBeenCalledWith({ ...f.key.attempt, journalAuthority: authority });
    expect(f.store.observe).toHaveBeenCalledWith({ key: f.key, journalAuthority: authority, snapshot: positive().value });
  });
  it('blocked claim has no network effects', async () => {
    const f = fixture(); f.store.claim.mockResolvedValue({ kind: 'blocked', reason: 'ownership_unknown' });
    const runtime = f.start(); await tick(); await runtime.close();
    expect(f.gateway.attempt).not.toHaveBeenCalled(); expect(f.store.observe).not.toHaveBeenCalled();
  });
  it('ACKed missing receipt never PUTs', async () => {
    const f = fixture(); f.claim('acknowledged'); const runtime = f.start(); await tick(); await runtime.close();
    expect(f.client.snapshot).toHaveBeenCalledTimes(1); expect(f.client.offer).not.toHaveBeenCalled();
  });
  it('ACKed positive receipt still reaches observe', async () => {
    const f = fixture(); f.claim('acknowledged'); f.client.snapshot.mockResolvedValue(positive());
    const runtime = f.start(); await tick(); await runtime.close();
    expect(f.store.observe).toHaveBeenCalledTimes(1); expect(f.client.offer).not.toHaveBeenCalled();
  });
});

const uncertainty: [string, ClientResult<AttemptSnapshot>][] = [
  ['generic404', { ok: false, error: { kind: 'response', status: 404 } }],
  ['transport', { ok: false, error: { kind: 'transport' } }],
  ['timeout', { ok: false, error: { kind: 'timeout' } }],
  ['cancelled', { ok: false, error: { kind: 'cancelled' } }],
  ['response', { ok: false, error: { kind: 'response' } }],
  ['wrong status', protocol({}, 400)],
  ['authority mismatch', protocol({ reason: 'authority_mismatch' }, 409)],
  ['wrong attempt', protocol({ attemptId: otherId })],
  ['wrong org', protocol({ organizationId: otherId })],
  ['wrong workspace', protocol({ workspaceId: otherId })],
  ['invalid protocol', protocol({ protocolVersion: 'wrong' } as never)],
  ['missing attempt', { ok: false, error: { kind: 'protocol', status: 404,
    protocol: { ...(missing() as { ok: false; error: { protocol: object } }).error.protocol, attemptId: undefined } as never } }],
  ['missing protocol', { ok: false, error: { kind: 'protocol', status: 404 } }],
];
it.each(uncertainty)('retains uncertainty for %s without reoffer, observation or fatal notification', async (_name, result) => {
  const f = fixture(); f.claim('replay'); f.client.snapshot.mockResolvedValue(result);
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.offer).not.toHaveBeenCalled(); expect(f.store.observe).not.toHaveBeenCalled();
  expect(f.onFailure).not.toHaveBeenCalled(); expect(runtime.state().status).toBe('closed');
});

it.each<Run['state']>(['finished', 'cancelled', 'errored'])('forbids original PUT for terminal %s', async state => {
  const f = fixture(); f.run.state = state;
  f.run.outcome = state === 'finished' ? 'passed' : 'inconclusive';
  if (state === 'finished') f.run.validationStatus = 'passed';
  else f.run.reason = 'cancelled';
  if (state === 'cancelled') f.run.cancellationRequested = true;
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.offer).not.toHaveBeenCalled();
});
it.each(['claimed', 'replay'] as const)('retains absent cancelled %s original without PUT/cancel/release', async kind => {
  const f = fixture(); f.claim(kind); f.run.cancellationRequested = true;
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.offer).not.toHaveBeenCalled(); expect(f.client.cancel).not.toHaveBeenCalled();
  expect(f.store.observe).not.toHaveBeenCalled();
});
it('observes a receipt then delivers same scoped cancellation and observes its receipt', async () => {
  const f = fixture(); f.claim('replay'); f.run.cancellationRequested = true; f.client.snapshot.mockResolvedValue(positive());
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.cancel.mock.calls[0]![0]).toEqual({ protocolVersion: '1.0', organizationId: f.key.attempt.organizationId,
    workspaceId: f.key.attempt.workspaceId, attemptId: f.key.attempt.attemptId, generation: 1 });
  expect(f.store.observe).toHaveBeenCalledTimes(2); expect(f.client.offer).not.toHaveBeenCalled();
});
it.each(['id', 'scope', 'activeAttemptId'] as const)('rejects a mismatched Run %s before PUT', async field => {
  const f = fixture();
  if (field === 'scope') f.run.scope.workspaceId = otherId;
  else f.run[field] = otherId;
  const runtime = f.start(); await tick(); await expect(runtime.close()).rejects.toThrow();
  expect(f.client.offer).not.toHaveBeenCalled(); expect(f.onFailure).toHaveBeenCalledTimes(1);
});

it.each([
  { kind: 'claimed', key: { ...fixture().key, runId: otherId }, journalAuthority: authority },
  { kind: 'replay', key: fixture().key, journalAuthority: undefined },
  { kind: 'acknowledged', journalAuthority: 'invalid' },
  { kind: 'claimed', key: fixture().key, journalAuthority: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase() },
])('rejects unbound or mismatched claims without network effects %#', async claim => {
  const f = fixture(); f.store.claim.mockResolvedValue(claim as never);
  const runtime = f.start(); await tick(); await expect(runtime.close()).rejects.toThrow();
  expect(f.gateway.attempt).not.toHaveBeenCalled(); expect(f.onFailure).toHaveBeenCalledTimes(1);
});
it('rejects an original with a different key before claiming', async () => {
  const f = fixture(); f.store.readOffer.mockResolvedValue({ key: { ...f.key, runId: otherId }, offer: {} as never });
  const runtime = f.start(); await tick(); await expect(runtime.close()).rejects.toThrow('Invalid delivery identity');
  expect(f.store.claim).not.toHaveBeenCalled(); expect(f.gateway.attempt).not.toHaveBeenCalled();
});
