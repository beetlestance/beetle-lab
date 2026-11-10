import { expect, it } from 'vitest';
import type { ClientResult, EventBatch, ProtocolError } from '@beetle/contracts';
import { binding, events, fixture, negative, otherId, state } from './fixture.js';

it('only a scoped protocol404 missing reply records missing receipt', async () => {
  const f = fixture(); f.client.events.mockResolvedValue(negative());
  await f.collect();
  expect(f.store.recordProblem).toHaveBeenCalledExactlyOnceWith({ binding: binding(), after: 0, kind: 'missing_receipt' });
  expect(f.store.ingest).not.toHaveBeenCalled(); expect(f.client.ack).not.toHaveBeenCalled();
});

const uncertain: [string, ClientResult<EventBatch>][] = [
  ['transport', { ok: false, error: { kind: 'transport' } }],
  ['timeout', { ok: false, error: { kind: 'timeout' } }],
  ['cancelled', { ok: false, error: { kind: 'cancelled' } }],
  ['generic404', { ok: false, error: { kind: 'response', status: 404 } }],
  ['wrong status', negative({}, 409)],
  ['wrong org', negative({ organizationId: otherId })],
  ['wrong workspace', negative({ workspaceId: otherId })],
  ['wrong attempt', negative({ attemptId: otherId })],
  ['authority conflict', negative({ reason: 'authority_mismatch' }, 409)],
  ['digest conflict', negative({ reason: 'conflicting_digest' }, 409)],
  ['unscoped expiry', negative({ reason: 'cursor_expired', attemptId: undefined,
    cursorRecovery: { retainedStartSeq: 3, snapshotAvailable: true } } as unknown as Partial<ProtocolError>, 410)],
  ['invalid expiry interval', negative({ reason: 'cursor_expired', cursorRecovery: { retainedStartSeq: 1, snapshotAvailable: true } }, 410)],
  ['expiry without recovery', negative({ reason: 'cursor_expired' }, 410)],
];
it.each(uncertain)('%s uncertainty fairly returns without ingest, ACK or diagnostics', async (_name, response) => {
  const f = fixture(); f.client.events.mockResolvedValue(response);
  await f.collect();
  expect(f.client.events).toHaveBeenCalledTimes(1); expect(f.store.ingest).not.toHaveBeenCalled();
  expect(f.client.ack).not.toHaveBeenCalled(); expect(f.store.recordProblem).not.toHaveBeenCalled();
});

it('matched cursor expiry leaves the storage owner to compare current durability', async () => {
  const f = fixture();
  f.client.events.mockImplementation(async () => {
    f.held.current = state({ durableThrough: 4, eventCount: 4, retainedBytes: 4000 });
    return negative({ reason: 'cursor_expired', cursorRecovery: { retainedStartSeq: 4, snapshotAvailable: true } }, 410);
  });
  f.store.recordProblem.mockImplementation(async () => f.held.current);
  await f.collect();
  expect(f.store.recordProblem).toHaveBeenCalledExactlyOnceWith({ binding: binding(), after: 0,
    kind: 'cursor_expired', retainedStartSeq: 4 });
  expect(f.held.current.coverage).toBe('contiguous'); expect(f.client.ack).not.toHaveBeenCalled();
});

it.each(['reorder', 'hole', 'cursor leap', 'empty cursor lie'])(
  'successful semantic %s batch returns fairly and replays the same cursor next turn', async kind => {
    const f = fixture(); const batch = events(2);
    if (kind === 'reorder') batch.events.reverse();
    if (kind === 'hole') batch.events[1]!.seq = 3;
    if (kind === 'cursor leap') batch.nextCursor = 3;
    if (kind === 'empty cursor lie') batch.events = [];
    f.client.events.mockResolvedValue({ ok: true, value: batch });
    await f.collect(); await f.collect();
    expect(f.client.events.mock.calls.map(([after]) => after)).toEqual([0, 0]);
    expect(f.store.ingest).not.toHaveBeenCalled(); expect(f.client.ack).not.toHaveBeenCalled();
    expect(f.store.recordProblem).not.toHaveBeenCalled();
  });

it.each(['scope', 'generation', 'schema', 'successful expiry'])(
  'invalid successful %s batch fails without diagnostics or ACK', async kind => {
    const f = fixture(); const batch = events();
    if (kind === 'scope') batch.organizationId = otherId;
    if (kind === 'generation') batch.events[0]!.generation = 2;
    if (kind === 'schema') batch.events[0]!.seq = -1;
    if (kind === 'successful expiry') batch.retainedStartSeq = 3;
    f.client.events.mockResolvedValue({ ok: true, value: batch });
    await expect(f.collect()).rejects.toThrow('Event batch');
    expect(f.store.ingest).not.toHaveBeenCalled(); expect(f.store.recordProblem).not.toHaveBeenCalled();
    expect(f.client.ack).not.toHaveBeenCalled();
  });

it('request construction failure propagates to the fatal owner', async () => {
  const f = fixture(); f.client.events.mockResolvedValue({ ok: false, error: { kind: 'request' } });
  await expect(f.collect()).rejects.toThrow('Invalid event custody request');
});

it('a thrown storage error with a quota-looking code is still fatal', async () => {
  const f = fixture();
  f.store.ingest.mockRejectedValue(Object.assign(new Error('native disk failure'), { code: 'quota_exhausted' }));
  await expect(f.collect()).rejects.toThrow('native disk failure');
  expect(f.store.recordProblem).not.toHaveBeenCalled(); expect(f.client.ack).not.toHaveBeenCalled();
});
