import { expect, it } from 'vitest';
import type { AttemptSnapshot } from '@beetle/contracts';
import { mergeAttemptObservation, MAX_ATTEMPT_OBSERVATION_BYTES } from '../../src/domain/runs/index.js';
import { exit, identity, merge, other, result, snapshot } from './run-observation-fixtures.js';

it.each(['attemptId', 'organizationId', 'workspaceId', 'intentDigest', 'generation'] as const)(
  'binds outer %s to the original before accepting a fact', key => {
    const value = snapshot(); Object.assign(value, { [key]: key === 'generation' ? 2 : key === 'intentDigest' ? 'b'.repeat(64) : other });
    expect(() => merge(value)).toThrow('Invalid value');
  });
it.each(['attemptId', 'organizationId', 'workspaceId', 'generation'] as const)('binds nested result %s', key => {
  const evidence = result(); Object.assign(evidence, { [key]: key === 'generation' ? 2 : other });
  expect(() => merge(snapshot({ result: evidence }))).toThrow('Invalid value');
});
it('binds retained previous observations too and never adopts another generation', () => {
  expect(() => merge(snapshot(), snapshot({ workspaceId: other }))).toThrow();
  expect(() => mergeAttemptObservation({ expected: { ...identity, generation: 2 },
    previous: null, incoming: snapshot({ generation: 2 }) })).toThrow();
});
it('validates cursor ordering without unsafe lastSeq+1 arithmetic', () => {
  expect(() => merge(snapshot({ retainedStartSeq: 2 }))).toThrow();
  expect(merge(snapshot({ retainedStartSeq: 1 })).snapshot.retainedStartSeq).toBe(1);
  const lastSeq = Number.MAX_SAFE_INTEGER;
  expect(merge(snapshot({ lastSeq, retainedStartSeq: lastSeq })).snapshot.lastSeq).toBe(lastSeq);
  expect(merge(snapshot({ lastSeq: lastSeq - 1, retainedStartSeq: lastSeq })).snapshot.retainedStartSeq).toBe(lastSeq);
});
it.each([
  { state: 'admitted' as const }, { phase: 'validate' as const }, { result: result() }, { exitEvidence: exit() },
])('equal-sequence projection changes, including witness presence, fail in both directions: %j', patch => {
  const before = snapshot(); const after = snapshot(patch);
  expect(() => merge(after, before)).toThrow(); expect(() => merge(before, after)).toThrow();
});
it('accepts canonical equal-sequence replay while independently merging cancellation and pruning', () => {
  const before = snapshot({ lastSeq: 5, exitEvidence: exit() });
  const after = snapshot({ lastSeq: 5, exitEvidence: { observedAt: exit().observedAt, oomKilled: null, exitCode: null },
    cancelRequested: true, retainedStartSeq: 6 });
  expect(merge(after, before).snapshot).toEqual({ ...before, cancelRequested: true, retainedStartSeq: 6 });
});
it('permits actual running->preparing chronology and handles reversed original replies', () => {
  const before = snapshot({ lastSeq: 2, state: 'running' });
  const after = snapshot({ lastSeq: 3, state: 'preparing', phase: 'validate' });
  expect(merge(after, before).snapshot).toEqual(after);
  expect(merge(before, after).snapshot).toEqual(after);
});
it.each([
  { phase: 'validate' as const }, {},
])('rejects phase rewind or disappearance on higher sequences in either arrival order: %j', patch => {
  const earlier = snapshot({ lastSeq: 2, state: 'running', phase: 'execute' });
  const later = snapshot({ lastSeq: 3, state: 'running', ...patch });
  expect(() => merge(later, earlier)).toThrow(); expect(() => merge(earlier, later)).toThrow();
});
it.each([
  ['admitted', 'offered'], ['running', 'admitted'], ['stopping', 'running'],
  ['lost', 'running'], ['exited', 'lost'], ['exited', 'collecting'],
] as const)('rejects impossible forward state %s->%s even when the earlier reply arrives last', (earlier, later) => {
  const before = snapshot({ lastSeq: 1, state: earlier }); const after = snapshot({ lastSeq: 2, state: later });
  expect(() => merge(after, before)).toThrow(); expect(() => merge(before, after)).toThrow();
});
it.each([
  ['stopping', 'lost'], ['stopping', 'exited'], ['lost', 'exited'], ['exited', 'exited'],
] as const)('allows sticky terminal progression %s->%s with late wrapper evidence', (earlier, later) => {
  const before = snapshot({ lastSeq: 1, state: earlier });
  const after = snapshot({ lastSeq: 2, state: later, phase: 'seal', result: result(), exitEvidence: exit() });
  const merged = merge(after, before);
  expect(merged.snapshot).toEqual(after); expect(merged.runState).toBe('finalizing');
  expect(Object.keys(merged).sort()).toEqual(['runState', 'snapshot']);
});
it('keeps the first public exit witness exact, including nulls and original observedAt', () => {
  const before = snapshot({ lastSeq: 1, state: 'exited', exitEvidence: exit() });
  for (const patch of [{ oomKilled: false }, { observedAt: '2026-01-02T00:00:00.000Z' }, { exitCode: 0 }]) {
    expect(() => merge(snapshot({ ...before, lastSeq: 2, exitEvidence: { ...exit(), ...patch } }), before)).toThrow();
  }
  expect(() => merge(snapshot({ lastSeq: 2, state: 'exited' }), before)).toThrow();
});
it('preserves immutable result evidence and rejects disappearance or contradiction', () => {
  const before = snapshot({ lastSeq: 1, result: result() });
  expect(() => merge(snapshot({ lastSeq: 2 }), before)).toThrow();
  expect(() => merge(snapshot({ lastSeq: 2, result: { ...result(), engineId: 'other' } }), before)).toThrow();
});
it('merges independently advanced cancellation/retention from an earlier original without rewinding state', () => {
  const latest = snapshot({ lastSeq: 10, state: 'exited', phase: 'collect', exitEvidence: exit() });
  const earlier = snapshot({ lastSeq: 8, state: 'collecting', phase: 'collect', cancelRequested: true, retainedStartSeq: 9 });
  expect(merge(earlier, latest).snapshot).toEqual({ ...latest, cancelRequested: true, retainedStartSeq: 9 });
});
it('captures without getter invocation, including on the command envelope', () => {
  let calls = 0; const incoming = snapshot();
  Object.defineProperty(incoming, 'result', { enumerable: true, get() { calls++; return result(); } });
  expect(() => merge(incoming)).toThrow(); expect(calls).toBe(0);
  const command = { expected: identity, previous: null, incoming: snapshot() };
  Object.defineProperty(command, 'incoming', { enumerable: true, get() { calls++; return snapshot(); } });
  expect(() => mergeAttemptObservation(command)).toThrow(); expect(calls).toBe(0);
});
it('rejects oversized data and non-JSON fields before retaining a snapshot', () => {
  expect(() => merge(snapshot({ intentDigest: 'x'.repeat(MAX_ATTEMPT_OBSERVATION_BYTES + 1) }))).toThrow();
  expect(() => merge({ ...snapshot(), retainedStartSeq: Number.NaN })).toThrow();
  expect(() => merge({ ...snapshot(), extra: undefined })).toThrow();
});
it('retains only deeply frozen copies and leaves both inputs unchanged', () => {
  const original = snapshot({ result: result() }); const old = structuredClone(original);
  const merged = merge(original);
  expect(original).toEqual(old); expect(Object.isFrozen(merged)).toBe(true);
  expect(Object.isFrozen(merged.snapshot.result)).toBe(true);
  original.result!.engineId = 'replacement';
  expect(merged.snapshot.result?.engineId).toBe('k6');
  expect(() => { (merged.snapshot as AttemptSnapshot).state = 'lost'; }).toThrow();
});
