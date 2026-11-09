import { expect, it } from 'vitest';
import { deliver } from '../../src/adapters/outbound/runner/delivery/attempt.js';
import type { DeliveryOperations } from '../../src/adapters/outbound/runner/delivery/attempt.js';
import { authority, fixture } from './fixture.js';

it('does not invoke Offer after close queued between the final Run helper and its caller', async () => {
  const f = fixture(); let armed = false; let closed = false;
  f.getRun.mockImplementation(async () => { armed = true; return structuredClone(f.run); });
  const operations: DeliveryOperations = { store: f.store, runs: { getRun: f.getRun },
    attempt: f.gateway.attempt.bind(f.gateway), signal: new AbortController().signal,
    stopped: () => {
      if (armed) { armed = false; queueMicrotask(() => { closed = true; }); }
      return closed;
    } };
  await deliver(operations, f.key);
  expect(closed).toBe(true); expect(f.client.offer).not.toHaveBeenCalled();
});
it('refuses a lowercase UUID URN claim before creating the attempt client', async () => {
  const f = fixture();
  f.store.claim.mockResolvedValue({ kind: 'claimed', key: f.key, journalAuthority: `urn:uuid:${authority}` });
  const operations: DeliveryOperations = { store: f.store, runs: { getRun: f.getRun },
    attempt: f.gateway.attempt.bind(f.gateway), signal: new AbortController().signal, stopped: () => false };
  await expect(deliver(operations, f.key)).rejects.toThrow('Invalid delivery claim');
  expect(f.gateway.attempt).not.toHaveBeenCalled(); expect(f.client.offer).not.toHaveBeenCalled();
});
