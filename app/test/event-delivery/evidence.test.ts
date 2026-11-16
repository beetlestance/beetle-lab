import { expect, it } from 'vitest';
import type { EventCursorState } from '../../src/ports/events.js';
import { progress, state as captureState } from '../../src/adapters/outbound/runner/events/state.js';
import { binding, fixture, negative, state } from './fixture.js';

const expiry = state({ durableThrough: 1, blockedReason: 'cursor_expired', coverage: 'partial', retainedStartSeq: 3 });
const missing: Record<string, unknown> = { ...expiry };
delete missing.retainedStartSeq;
const invalidExpiry: [string, unknown][] = [
  ['contiguous expiry', { ...expiry, coverage: 'contiguous' }],
  ['null expiry metadata', { ...expiry, retainedStartSeq: null }],
  ['missing expiry metadata', missing],
  ['covered expiry interval', { ...expiry, retainedStartSeq: 1 }],
  ['adjacent retained prefix', { ...expiry, retainedStartSeq: 2 }],
  ['negative expiry metadata', { ...expiry, retainedStartSeq: -1 }],
  ['fractional expiry metadata', { ...expiry, retainedStartSeq: 3.5 }],
  ['unsafe expiry metadata', { ...expiry, retainedStartSeq: Number.MAX_SAFE_INTEGER + 1 }],
  ['clear state with expiry metadata', state({ durableThrough: 1, retainedStartSeq: 3 })],
  ['other problem with expiry metadata', state({ durableThrough: 1, blockedReason: 'quota_exhausted', retainedStartSeq: 3 })],
  ['other problem with partial coverage', state({ durableThrough: 1, blockedReason: 'replay_conflict', coverage: 'partial' })],
];
it.each(invalidExpiry)('rejects %s on load before gateway effects', async (_name, value) => {
  const f = fixture(); f.store.load.mockResolvedValue(value as EventCursorState);
  await expect(f.collect()).rejects.toThrow(); expect(f.attempt).not.toHaveBeenCalled();
});

it.each(['ingest', 'problem', 'confirm'] as const)('rejects false expiry metadata in a positive %s reply', async stage => {
  const f = fixture();
  const falseExpiry = state({ durableThrough: 1, blockedReason: 'cursor_expired', coverage: 'partial' });
  if (stage === 'ingest') f.store.ingest.mockResolvedValue({ state: falseExpiry, ackThrough: 1, inserted: 0 });
  if (stage === 'problem') {
    f.client.events.mockResolvedValue(negative()); f.store.recordProblem.mockResolvedValue(falseExpiry);
  }
  if (stage === 'confirm') f.store.confirmAck.mockResolvedValue({ ...falseExpiry, ackConfirmedThrough: 1 });
  await expect(f.collect()).rejects.toThrow();
  if (stage !== 'confirm') expect(f.client.ack).not.toHaveBeenCalled();
});

it('accepts maximum safe expiry metadata using overflow-safe gap validation', async () => {
  const f = fixture(); f.held.current = { ...expiry, retainedStartSeq: Number.MAX_SAFE_INTEGER };
  await f.collect(); expect(f.attempt).not.toHaveBeenCalled();
  expect(captureState(f.held.current, binding()).retainedStartSeq).toBe(Number.MAX_SAFE_INTEGER);
});

const blocked: EventCursorState[] = [
  expiry,
  state({ durableThrough: 1, blockedReason: 'quota_exhausted' }),
  state({ durableThrough: 1, blockedReason: 'replay_conflict' }),
  state({ durableThrough: 1, blockedReason: 'missing_receipt' }),
];
it.each(blocked)('rejects clearing first $blockedReason evidence even while ACK confirmation advances', prior => {
  const current = captureState(state({ durableThrough: 1, ackConfirmedThrough: 1 }), binding());
  expect(() => progress(current, captureState(prior, binding()))).toThrow('Invalid event custody reply');
});

it.each(blocked)('rejects replacing first $blockedReason evidence with another valid problem', prior => {
  const current = captureState(state({ durableThrough: 1, ackConfirmedThrough: 1,
    blockedReason: prior.blockedReason === 'quota_exhausted' ? 'replay_conflict' : 'quota_exhausted' }), binding());
  expect(() => progress(current, captureState(prior, binding()))).toThrow('Invalid event custody reply');
});

it('rejects replacing the first retained-start evidence with a different valid expiry', () => {
  const prior = captureState(expiry, binding());
  const current = captureState({ ...expiry, ackConfirmedThrough: 1, retainedStartSeq: 4 }, binding());
  expect(() => progress(current, prior)).toThrow('Invalid event custody reply');
});

it.each(blocked)('allows issued positive ACK confirmation while retaining first $blockedReason evidence', prior => {
  const current = captureState({ ...prior, ackConfirmedThrough: 1 }, binding());
  expect(() => progress(current, captureState(prior, binding()))).not.toThrow();
  expect(current).toMatchObject({ coverage: prior.coverage, blockedReason: prior.blockedReason,
    retainedStartSeq: prior.retainedStartSeq, ackConfirmedThrough: 1 });
});
