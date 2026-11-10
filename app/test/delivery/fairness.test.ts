import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DispatchPage } from '../../src/ports/dispatch.js';
import { candidate, fixture, queueScanner, tick } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('alternates bounded lanes and advances after one selected item despite remote uncertainty', async () => {
  const f = fixture(); f.claim('replay'); f.client.snapshot.mockResolvedValue({ ok: false, error: { kind: 'timeout' } });
  f.store.scan.mockImplementation(async query => ({ items: [candidate(query.lane === 'queued' ? 1 : 2)], nextCursor: null }));
  f.store.claim.mockImplementation(async key => ({ kind: 'replay', key, journalAuthority: '33333333-3333-4333-8333-333333333333' }));
  const runtime = f.start(); await tick(150); await runtime.close();
  expect(f.store.scan.mock.calls.map(([query]) => query.lane)).toEqual(['queued', 'reconcile', 'queued', 'reconcile', 'queued']);
  expect(f.store.scan.mock.calls.every(([query]) => query.limit === 32)).toBe(true);
  expect(f.store.claim.mock.calls.map(([key]) => key.attempt.attemptId)).toEqual([1, 2, 1, 2, 1].map(i => candidate(i).key.attempt.attemptId));
  expect(f.client.snapshot).toHaveBeenCalledTimes(5); expect(f.client.offer).not.toHaveBeenCalled();
});
it('traverses more than32 blocked items and revisits blocked prefix next captured pass', async () => {
  const f = fixture(); const items = Array.from({ length: 35 }, (_, i) => candidate(i + 1, i === 34));
  f.store.scan.mockImplementation(queueScanner(items)); f.store.claim.mockResolvedValue({ kind: 'blocked', reason: 'budget_unavailable' });
  const runtime = f.start(); await tick(300); await runtime.close();
  expect(f.store.claim.mock.calls.map(([key]) => key.attempt.attemptId)).toEqual([items[34]!.key.attempt.attemptId, items[34]!.key.attempt.attemptId]);
  const queued = f.store.scan.mock.calls.map(([query]) => query).filter(query => query.lane === 'queued');
  expect(queued.map(query => query.cursor)).toEqual([undefined, '32:35', '35:35', undefined, '32:35']);
});
it('resumes selected item.after on final page and does not skip unread eligible successors', async () => {
  const f = fixture(); const items = [candidate(1), candidate(2), candidate(3)];
  f.store.scan.mockImplementation(queueScanner(items)); f.store.claim.mockResolvedValue({ kind: 'blocked', reason: 'budget_unavailable' });
  const runtime = f.start(); await tick(150); await runtime.close();
  expect(f.store.claim.mock.calls.map(([key]) => key.attempt.attemptId)).toEqual(items.map(item => item.key.attempt.attemptId));
  expect(f.store.scan.mock.calls[2]![0].cursor).toBe('1:3');
});
it('preserves captured upper order through removals and empty tails before admitting new arrivals', async () => {
  const f = fixture(); const items = [candidate(1), candidate(2), candidate(3)];
  f.store.scan.mockImplementation(queueScanner(items)); f.store.claim.mockResolvedValue({ kind: 'blocked', reason: 'budget_unavailable' });
  const runtime = f.start(); await tick();
  items.splice(0, items.length, candidate(4));
  await tick(150); await runtime.close();
  expect(f.store.claim.mock.calls.map(([key]) => key.attempt.attemptId)).toEqual([candidate(1).key.attempt.attemptId, candidate(4).key.attempt.attemptId]);
  const queued = f.store.scan.mock.calls.map(([query]) => query).filter(query => query.lane === 'queued');
  expect(queued.map(query => query.cursor)).toEqual([undefined, '1:3', undefined]);
});
it.each<DispatchPage>([
  { items: Array.from({ length: 33 }, (_, i) => candidate(i + 1)), nextCursor: null },
  { items: [{ ...candidate(), after: 'x'.repeat(1025) }], nextCursor: null },
  { items: [], nextCursor: 'empty-tail' },
  { items: [candidate()], nextCursor: 'wrong-after' },
  { items: [{ ...candidate(), order: -1 }], nextCursor: null },
  { items: [{ ...candidate(), key: { ...candidate().key, runId: 'invalid' } }], nextCursor: null },
  { items: [{ ...candidate(), eligibility: { kind: 'unknown' } as never }], nextCursor: null },
])('rejects invalid discovery before retaining a cursor or reading Offer %#', async page => {
  const f = fixture(); f.store.scan.mockResolvedValue(page); const runtime = f.start(); await tick();
  await expect(runtime.close()).rejects.toThrow(); expect(f.onFailure).toHaveBeenCalledTimes(1);
  expect(f.store.readOffer).not.toHaveBeenCalled();
});
it('bounds total discovery reply bytes even with compact valid candidates', async () => {
  const f = fixture(); const item = { ...candidate(), extra: 'x'.repeat(65_536) };
  f.store.scan.mockResolvedValue({ items: [item], nextCursor: null });
  const runtime = f.start(); await tick(); await expect(runtime.close()).rejects.toThrow();
  expect(f.store.readOffer).not.toHaveBeenCalled();
});

it('revisits a newly eligible blocked prefix after the finite captured pass', async () => {
  const f = fixture(); const items = Array.from({ length: 35 }, (_, i) => candidate(i + 1, i === 34));
  f.store.scan.mockImplementation(queueScanner(items)); f.store.claim.mockResolvedValue({ kind: 'blocked', reason: 'budget_unavailable' });
  const runtime = f.start(); await tick(75); items[0] = candidate(1);
  await tick(150); await runtime.close();
  expect(f.store.claim.mock.calls.map(([key]) => key.attempt.attemptId)).toEqual([candidate(35).key.attempt.attemptId, candidate(1).key.attempt.attemptId]);
});
