import { expect, it, vi } from 'vitest';
import { eventDiscovery } from '../../src/adapters/outbound/runner/delivery/event-discovery.js';
import type { EventCandidate, EventCustodyStore, EventPage } from '../../src/ports/events.js';
import { binding } from '../event-delivery/fixture.js';
function ready(order = 1): EventCandidate { return { kind: 'ready', binding: binding(), order, after: `after-${order}` }; }
function unbound(order = 1): EventCandidate { return { kind: 'unbound', key: binding().key, order, after: `after-${order}` }; }
it('retains a selected final-page continuation so unread successors are visited', async () => {
  const scan = vi.fn<EventCustodyStore['scan']>()
    .mockResolvedValueOnce({ items: [ready(1), ready(2)], nextCursor: null })
    .mockResolvedValueOnce({ items: [ready(2)], nextCursor: null })
    .mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockResolvedValueOnce({ items: [ready(1)], nextCursor: null });
  const next = eventDiscovery(scan);
  expect((await next())?.order).toBe(1); expect((await next())?.order).toBe(2);
  expect(await next()).toBeUndefined(); expect((await next())?.order).toBe(1);
  expect(scan.mock.calls.map(([q]) => q.cursor)).toEqual([undefined, 'after-1', 'after-2', undefined]);
});
it('advances through full unbound pages then resets the finite pass without creating authority', async () => {
  const scan = vi.fn<EventCustodyStore['scan']>()
    .mockResolvedValueOnce({ items: Array.from({ length: 32 }, (_, i) => unbound(i + 1)), nextCursor: 'after-32' })
    .mockResolvedValueOnce({ items: [unbound(33), ready(34), ready(35)], nextCursor: null })
    .mockResolvedValueOnce({ items: [ready(35)], nextCursor: null });
  const next = eventDiscovery(scan); expect(await next()).toBeUndefined();
  expect((await next())?.order).toBe(34); expect((await next())?.order).toBe(35);
  expect(scan.mock.calls.map(([q]) => q.cursor)).toEqual([undefined, 'after-32', 'after-34']);
});
it.each([
  { items: Array.from({ length: 33 }, (_, i) => ready(i)), nextCursor: null },
  { items: [ready()], nextCursor: 'wrong' }, { items: [], nextCursor: 'empty' },
  { items: [{ ...ready(), after: 'x'.repeat(1025) }], nextCursor: null },
  { items: [{ ...ready(), order: Number.MAX_SAFE_INTEGER + 1 }], nextCursor: null },
  { items: [{ ...unbound(), key: { ...binding().key, extra: true } }], nextCursor: null },
])('rejects invalid discovery %#', async input => {
  const scan = vi.fn<EventCustodyStore['scan']>(async () => input as EventPage);
  await expect(eventDiscovery(scan)()).rejects.toThrow();
});
it.each(['page', 'candidate', 'binding', 'key', 'array'] as const)('rejects hidden or symbol additions in original %s carriers', async location => {
  const input = { items: [ready()], nextCursor: null };
  const item = input.items[0]! as Extract<EventCandidate, { kind: 'ready' }>;
  const target = { page: input, candidate: item, binding: item.binding, key: item.binding.key, array: input.items }[location];
  Object.defineProperty(target, Symbol('hidden'), { value: true });
  const scan = vi.fn<EventCustodyStore['scan']>(async () => input);
  await expect(eventDiscovery(scan)()).rejects.toThrow();
});
it('does not invoke an original candidate getter', async () => {
  const item = ready(); const getter = vi.fn(() => 'ready'); Object.defineProperty(item, 'kind', { get: getter });
  const scan = vi.fn<EventCustodyStore['scan']>(async () => ({ items: [item], nextCursor: null }));
  await expect(eventDiscovery(scan)()).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
});
