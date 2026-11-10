import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AttemptSnapshot, ClientResult } from '@beetle/contracts';
import { deferred, fixture, missing, offer, otherId, positive, protocol, tick } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('never creates refusal evidence for an acknowledged missing receipt', async () => {
  const f = fixture(); f.claim('acknowledged'); f.run.cancellationRequested = true;
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.snapshot).toHaveBeenCalledTimes(1);
  expect(f.client.cancelOriginal).not.toHaveBeenCalled(); expect(f.client.offer).not.toHaveBeenCalled();
  expect(f.store.observe).not.toHaveBeenCalled();
});

it.each<ClientResult<AttemptSnapshot>>([
  { ok: false, error: { kind: 'response', status: 404 } },
  { ok: false, error: { kind: 'transport' } }, protocol({ workspaceId: otherId }),
  protocol({ reason: 'invalid_protocol' }), protocol({ reason: 'attempt_not_found' }, 409),
])('retains cancelled uncertainty without a validated scoped missing receipt %#', async value => {
  const f = fixture(); f.run.cancellationRequested = true; f.client.snapshot.mockResolvedValue(value);
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.cancelOriginal).not.toHaveBeenCalled(); expect(f.client.offer).not.toHaveBeenCalled();
  expect(f.store.observe).not.toHaveBeenCalled();
});

it('uses the same persisted original after lost refusal reply without any normal PUT', async () => {
  const f = fixture(); f.claim('replay'); f.run.cancellationRequested = true;
  f.client.cancelOriginal.mockResolvedValue({ ok: false, error: { kind: 'transport' } });
  const runtime = f.start(); await tick(50); await runtime.close();
  expect(f.client.cancelOriginal.mock.calls.length).toBeGreaterThan(1);
  for (const [body] of f.client.cancelOriginal.mock.calls) expect(body).toEqual(offer());
  expect(f.client.offer).not.toHaveBeenCalled(); expect(f.store.observe).not.toHaveBeenCalled();
});

it('rechecks terminal history after a fresh claim absence read settles', async () => {
  const f = fixture(); f.run.cancellationRequested = true;
  const pending = deferred<ClientResult<AttemptSnapshot>>(); f.client.snapshot.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick();
  f.run.state = 'finished'; f.run.outcome = 'passed'; f.run.validationStatus = 'passed';
  pending.resolve(missing()); await tick(); await runtime.close();
  expect(f.client.cancelOriginal).not.toHaveBeenCalled(); expect(f.client.offer).not.toHaveBeenCalled();
});

it('cancels an existing positive receipt without creating a fresh refusal', async () => {
  const f = fixture(); f.run.cancellationRequested = true; f.client.snapshot.mockResolvedValue(positive());
  const runtime = f.start(); await tick(); await runtime.close();
  expect(f.client.cancel).toHaveBeenCalledTimes(1);
  expect(f.client.cancelOriginal).not.toHaveBeenCalled(); expect(f.client.offer).not.toHaveBeenCalled();
  expect(f.store.observe).toHaveBeenCalledTimes(2);
});
