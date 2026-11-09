import { expect, it } from 'vitest';
import type { AttemptAdmission } from '@beetle/contracts';
import { merge, snapshot } from './run-observation-fixtures.js';

const facts: AttemptAdmission[] = [{ state: 'queued' }, { state: 'charged' },
  { state: 'released', disposition: 'never_started' }, { state: 'released', disposition: 'settled' },
  { state: 'rejected', reason: 'cancelled' }, { state: 'rejected', reason: 'per_run_ceiling' }];
it.each(facts)('equal independent fact %j replays without changing the event projection', admission => {
  const value = snapshot({ admission }); expect(merge(value, value).snapshot).toEqual(value);
});
it.each(facts)('missing/absent independent facts cannot erase %j', admission => {
  expect(merge(snapshot(), snapshot({ admission })).snapshot.admission).toEqual(admission);
  expect(merge(snapshot({ admission }), snapshot()).snapshot.admission).toEqual(admission);
});
it.each([
  [{ state: 'queued' }, { state: 'charged' }],
  [{ state: 'queued' }, { state: 'released', disposition: 'never_started' }],
  [{ state: 'charged' }, { state: 'released', disposition: 'settled' }],
  [{ state: 'queued' }, { state: 'rejected', reason: 'cancelled' }],
] as const)('independent order wins in both arrival directions: %j->%j', (earlier, later) => {
  expect(merge(snapshot({ admission: later }), snapshot({ admission: earlier })).snapshot.admission).toEqual(later);
  expect(merge(snapshot({ admission: earlier }), snapshot({ admission: later })).snapshot.admission).toEqual(later);
});
it.each([
  [{ state: 'charged' }, { state: 'rejected', reason: 'cancelled' }],
  [{ state: 'released', disposition: 'settled' }, { state: 'rejected', reason: 'cancelled' }],
  [{ state: 'released', disposition: 'never_started' }, { state: 'released', disposition: 'settled' }],
  [{ state: 'rejected', reason: 'cancelled' }, { state: 'rejected', reason: 'per_run_ceiling' }],
] as const)('rejects incomparable/conflicting facts in both arrival directions: %j vs %j', (left, right) => {
  expect(() => merge(snapshot({ admission: left }), snapshot({ admission: right }))).toThrow();
  expect(() => merge(snapshot({ admission: right }), snapshot({ admission: left }))).toThrow();
});
it('retains a final independent fact even when received on an older event sequence', () => {
  const previous = snapshot({ lastSeq: 5, state: 'admitted', admission: { state: 'charged' } });
  const incoming = snapshot({ lastSeq: 3, state: 'admitted', admission: { state: 'released', disposition: 'never_started' } });
  const value = merge(incoming, previous);
  expect(value.snapshot.lastSeq).toBe(5); expect(value.snapshot.admission).toEqual(incoming.admission);
  expect(value.runState).toBe('finalizing');
});
it.each(facts.filter(f => f.state === 'released' || f.state === 'rejected'))(
  'final admission %j selects finalizing without a terminal result or invented event ACK', admission => {
    const value = merge(snapshot({ admission }));
    expect(value.runState).toBe('finalizing'); expect(value.snapshot.lastSeq).toBe(0);
    expect(value.snapshot.result).toBeUndefined(); expect(Object.keys(value).sort()).toEqual(['runState', 'snapshot']);
  });
it('leaves unknown and merely charged snapshots nonterminal', () => {
  expect(merge(snapshot()).runState).toBe('dispatching');
  expect(merge(snapshot({ state: 'running', admission: { state: 'charged' } })).runState).toBe('active');
});
