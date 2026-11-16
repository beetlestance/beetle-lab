import { expect, it } from 'vitest';
import { binding, events, fixture, negative, receipt, state } from './fixture.js';

it('stores one original batch before ACK and confirms only its durable prefix', async () => {
  const f = fixture();
  const batch = events();
  f.client.events.mockResolvedValue({ ok: true, value: batch });
  await f.collect();
  expect(f.calls).toEqual(['load', 'ingest', 'ACK', 'confirm']);
  expect(f.store.ingest).toHaveBeenCalledExactlyOnceWith({ binding: binding(), after: 0, batch });
  expect(f.store.ingest.mock.calls[0]![0].batch).toBe(batch);
  expect(f.client.events).toHaveBeenCalledExactlyOnceWith(0, f.operations.signal);
  expect(f.client.ack.mock.calls[0]![0].throughSeq).toBe(1);
  expect(f.store.confirmAck).toHaveBeenCalledExactlyOnceWith({ binding: binding(), throughSeq: 1, receipt: receipt() });
  expect(f.held.current.ackConfirmedThrough).toBe(1);
  expect(f.attempt).toHaveBeenCalledExactlyOnceWith({ ...binding().key.attempt, journalAuthority: binding().journalAuthority });
  expect(f.store.scan).not.toHaveBeenCalled();
  expect(f.client.offer).not.toHaveBeenCalled(); expect(f.client.cancel).not.toHaveBeenCalled();
  expect(f.client.snapshot).not.toHaveBeenCalled(); expect(f.client.cancelOriginal).not.toHaveBeenCalled();
});

it('recovers pending ACK before GET even after remote spool pruning', async () => {
  const f = fixture();
  f.held.current = state({ durableThrough: 5, ackConfirmedThrough: 2, eventCount: 5, retainedBytes: 5000 });
  await f.collect();
  expect(f.calls).toEqual(['load', 'ACK', 'confirm']);
  expect(f.client.events).not.toHaveBeenCalled(); expect(f.store.ingest).not.toHaveBeenCalled();
  expect(f.client.ack.mock.calls[0]![0].throughSeq).toBe(5);
});

it('an ACK lost reply retries the stored prefix on a new load without GET', async () => {
  const f = fixture();
  f.client.ack.mockResolvedValueOnce({ ok: false, error: { kind: 'timeout' } });
  await f.collect();
  expect(f.held.current.durableThrough).toBe(1); expect(f.held.current.ackConfirmedThrough).toBe(0);
  expect(f.store.confirmAck).not.toHaveBeenCalled();
  await f.collect();
  expect(f.store.load).toHaveBeenCalledTimes(2); expect(f.client.events).toHaveBeenCalledTimes(1);
  expect(f.client.ack.mock.calls.map(([request]) => request.throughSeq)).toEqual([1, 1]);
  expect(f.held.current.ackConfirmedThrough).toBe(1);
});

it('a committed ingest with a lost reply issues no ACK until a later load', async () => {
  const f = fixture();
  const ingest = f.store.ingest.getMockImplementation()!;
  f.store.ingest.mockImplementationOnce(async request => { await ingest(request); throw new Error('lost original ingest reply'); });
  await expect(f.collect()).rejects.toThrow('lost original ingest reply');
  expect(f.held.current.durableThrough).toBe(1); expect(f.client.ack).not.toHaveBeenCalled();
  await f.collect();
  expect(f.store.ingest).toHaveBeenCalledTimes(1); expect(f.client.events).toHaveBeenCalledTimes(1);
  expect(f.held.current.ackConfirmedThrough).toBe(1);
});

it.each(['quota_exhausted', 'replay_conflict', 'missing_receipt', 'cursor_expired'] as const)(
  'blocked %s state returns without gateway or mutation effects', async blockedReason => {
    const f = fixture();
    f.held.current = state({ durableThrough: 5, blockedReason,
      coverage: blockedReason === 'cursor_expired' ? 'partial' : 'contiguous',
      retainedStartSeq: blockedReason === 'cursor_expired' ? 7 : null });
    await f.collect();
    expect(f.calls).toEqual(['load']); expect(f.attempt).not.toHaveBeenCalled();
    expect(f.store.recordProblem).not.toHaveBeenCalled();
  });

it.each(['quota_exhausted', 'replay_conflict'] as const)('expected %s ingest blockage skips ACK', async blockedReason => {
  const f = fixture();
  f.store.ingest.mockResolvedValue({ state: state({ blockedReason }), ackThrough: 0, inserted: 0 });
  await f.collect();
  expect(f.client.ack).not.toHaveBeenCalled(); expect(f.store.recordProblem).not.toHaveBeenCalled();
});

it('empty batch is ingested without inventing closure or issuing an ACK at zero', async () => {
  const f = fixture(); f.client.events.mockResolvedValue({ ok: true, value: events(0) });
  await f.collect();
  expect(f.store.ingest).toHaveBeenCalledTimes(1); expect(f.client.ack).not.toHaveBeenCalled();
  expect(f.held.current).toMatchObject({ durableThrough: 0, ackConfirmedThrough: 0, blockedReason: null });
});

it('ACKs only the permitted lower prefix when concurrent durable growth is returned', async () => {
  const f = fixture();
  f.store.ingest.mockResolvedValue({ state: state({ durableThrough: 3, retainedBytes: 5000, eventCount: 3 }),
    ackThrough: 1, inserted: 1 });
  f.store.confirmAck.mockResolvedValue(state({ durableThrough: 3, ackConfirmedThrough: 1, retainedBytes: 5000, eventCount: 3 }));
  await f.collect(); expect(f.client.ack.mock.calls[0]![0].throughSeq).toBe(1);
});

it('accepts concurrently stored equal records with zero inserts and complete retained counters', async () => {
  const f = fixture();
  f.store.ingest.mockResolvedValue({ state: state({ durableThrough: 1, retainedBytes: 1000, eventCount: 1 }),
    ackThrough: 1, inserted: 0 });
  f.store.confirmAck.mockResolvedValue(state({ durableThrough: 1, ackConfirmedThrough: 1, retainedBytes: 1000, eventCount: 1 }));
  await f.collect(); expect(f.client.ack.mock.calls[0]![0].throughSeq).toBe(1);
});

it('a matched pending ACK attempt-not-found records the missing original', async () => {
  const f = fixture(); f.held.current = state({ durableThrough: 1 });
  f.client.ack.mockResolvedValue(negative());
  await f.collect();
  expect(f.store.recordProblem).toHaveBeenCalledExactlyOnceWith({ binding: binding(), after: 1, kind: 'missing_receipt' });
  expect(f.store.confirmAck).not.toHaveBeenCalled();
});
