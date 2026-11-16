import { expect, it, vi } from 'vitest';
import { ProducerGate } from '../../src/producer-gate/index.js';
import type { JournalRetirements } from '../../src/retirement-values/index.js';
import { makeRetirementIntent } from '../../src/retirement-values/index.js';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import request from '../../../contracts/fixtures/valid/output-retirement-absence.json' with { type: 'json' };
import { deferred } from '../output-transfer/fixtures.js';
const value = captureOutputRetirementRequest(request);
const key = { organizationId: value.organizationId, workspaceId: value.workspaceId, attemptId: value.attemptId, generation: 1 };
const intent = makeRetirementIntent({ request: value, namespaceIdentity: 'a'.repeat(64), task: { state: 'none' } });
function fixture() {
  const port: JournalRetirements = { isOpen: vi.fn(async () => true), read: vi.fn(async () => intent),
    preflight: vi.fn(async () => intent), begin: vi.fn(async () => intent), settleCarrier: vi.fn(async () => {}) };
  return { port, gate: new ProducerGate({ journal: port, namespaceIdentity: intent.namespaceIdentity }) };
}
it('reserves before Journal calls, leaves intake open through preflight reservation and fences before begin', async () => {
  const { gate, port } = fixture(); const lease = gate.acquire(key); const held = deferred<boolean>();
  vi.mocked(port.isOpen).mockReturnValueOnce(held.promise); const opening = lease.ready();
  const slot = gate.reserve(key); expect(() => lease.check()).not.toThrow();
  slot.fence(); expect(() => gate.acquire(key)).toThrow('retired'); held.resolve(true);
  await expect(opening).rejects.toThrow('retired');
  let drained = false; const draining = slot.drain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false); expect(() => slot.release()).toThrow('cleanup');
  lease.finish(); await draining; await slot.confirm(intent); slot.release(); expect(gate.status()).toEqual({ entries: 0, leases: 0 });
  vi.mocked(port.isOpen).mockResolvedValue(false);
  const next = gate.acquire(key); await expect(next.ready()).rejects.toThrow('retired'); next.finish();
  expect(gate.status()).toEqual({ entries: 0, leases: 0 });
});
it('refuses duplicate Journal owners, foreign ports/namespace records and unconfirmed fence eviction', async () => {
  const { gate, port } = fixture(); expect(() => new ProducerGate({ journal: port, namespaceIdentity: 'a'.repeat(64) })).toThrow('owner');
  expect(() => gate.assertOwner(fixture().port)).toThrow('owner');
  const slot = gate.reserve(key); slot.fence();
  await expect(slot.confirm({ ...intent, namespaceIdentity: 'b'.repeat(64) })).rejects.toThrow('owner');
  vi.mocked(port.read).mockResolvedValue(null); await expect(slot.confirm(intent)).rejects.toThrow('owner');
  expect(() => slot.release()).toThrow('cleanup'); expect(gate.status()).toEqual({ entries: 1, leases: 0 });
});
it('reserves bounded entries and lease originals without side effects at capacity', () => {
  const { gate, port } = fixture(); const leases = [];
  for (let n = 1; n <= 64; n++) leases.push(gate.acquire({ ...key, attemptId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` }));
  expect(() => gate.acquire(key)).toThrow('capacity'); expect(port.isOpen).not.toHaveBeenCalled();
  expect(() => gate.reserve({ ...key, attemptId: '00000000-0000-4000-8000-000000009999' })).toThrow('capacity');
  for (const lease of leases) lease.finish(); expect(gate.status()).toEqual({ entries: 0, leases: 0 });
});
it('keeps poisoned original and credits after rejection instead of manufacturing drain', async () => {
  const { gate } = fixture(); const lease = gate.acquire(key); const original = {}; lease.issue(() => original);
  const slot = gate.reserve(key); slot.fence(); const draining = slot.drain(); lease.poison();
  await expect(draining).rejects.toThrow('cleanup'); expect(lease.finish()).toBe(false);
  await slot.confirm(intent); expect(() => slot.release()).toThrow('cleanup'); expect(gate.status()).toEqual({ entries: 1, leases: 1 });
});
it('releases unissued preflight reservation without touching existing leases', () => {
  const { gate } = fixture(); const lease = gate.acquire(key); const slot = gate.reserve(key); slot.release();
  expect(() => lease.check()).not.toThrow(); expect(gate.status()).toEqual({ entries: 1, leases: 1 }); lease.finish();
  expect(gate.status()).toEqual({ entries: 0, leases: 0 });
});

it('reserves each retained original before invoking its factory and refuses overflow without issuing it', () => {
  const { gate } = fixture(); const lease = gate.acquire(key);
  for (let n = 0; n < 4; n++) lease.issue(() => ({}));
  const factory = vi.fn(() => ({})); expect(() => lease.issue(factory)).toThrow('capacity'); expect(factory).not.toHaveBeenCalled();
  expect(lease.finish()).toBe(true); expect(gate.status()).toEqual({ entries: 0, leases: 0 });
});

it('shutdown retains held leases and refuses a clean result for poisoned custody', async () => {
  const { gate } = fixture(); const lease = gate.acquire(key); let closed = false;
  const closing = gate.close(); const same = gate.close(); expect(same).toBe(closing);
  void closing.then(() => { closed = true; }, () => undefined);
  await Promise.resolve(); expect(closed).toBe(false); expect(() => gate.acquire(key)).toThrow('closed');
  lease.finish(); await closing; expect(gate.status()).toEqual({ entries: 0, leases: 0 });
  const failed = fixture(); const held = failed.gate.acquire(key); held.issue(() => ({})); held.poison();
  await expect(failed.gate.close()).rejects.toThrow('cleanup'); expect(failed.gate.status().leases).toBe(1);
});
