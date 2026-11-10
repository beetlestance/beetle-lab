import { expect, it } from 'vitest';
import type { EngineResult } from '@beetle/contracts';
import { finalizationFixture } from './fixture.js';

it('preserves child99 failure and discovery success under wrapper0, independently of wrapper timestamps', () => {
  const failed = finalizationFixture({ result: value => ({ ...value, outcome: 'failed', execution: { ...value.execution,
    status: 'completed', exitCode: 99 }, requiredAssertions: { required: 2, passed: 1, failed: 1, unknown: 0 } }) });
  failed.ready(); expect(failed.finalize()).toMatchObject({ kind: 'finalized', receipt: {
    state: 'finished', outcome: 'failed', validationStatus: 'passed', reason: null } });
  const discovery = finalizationFixture({ result: value => ({ ...value, mode: 'discovery', expectedAbort: { ruleId: 'discovered', reached: true },
    execution: { ...value.execution, status: 'completed', exitCode: 99 }, thresholds: [{ id: 'discovered', purpose: 'discovery', passed: false }] }) });
  discovery.ready(); expect(discovery.finalize()).toMatchObject({ kind: 'finalized', receipt: {
    state: 'finished', outcome: 'passed', validationStatus: 'passed', reason: null } });
});

it.each([
  [{ exitCode: 137, oomKilled: true }, 'memory_limit'],
  [{ exitCode: null, oomKilled: true }, 'memory_limit'],
  [{ exitCode: 42, oomKilled: false }, 'engine_crash'],
  [{ exitCode: 42, oomKilled: false, reason: 'timeout' }, 'timeout'],
  [{ exitCode: 0, oomKilled: false, reason: 'output_limit' }, 'output_limit'],
] as const)('uses confirmed wrapper failure evidence %j', (exit, reason) => {
  const f = finalizationFixture(); f.adopt(); f.release({ exitEvidence: { ...exit, observedAt: '2026-01-01T00:01:00Z' } });
  f.ingest(); f.confirm();
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: {
    state: 'errored', outcome: 'inconclusive', validationStatus: 'passed', reason } });
});

function incomplete(status: 'error' | 'lost', reason: 'invalid_config' | 'execution_lost' | 'engine_crash') {
  return (value: EngineResult): EngineResult => ({ ...value, outcome: 'inconclusive', completeness: 'missing',
    execution: status === 'lost' ? { status: 'lost', reason: 'execution_lost', exitCode: null, stoppedAt: '2026-01-01T00:00:00Z' }
      : { status: 'error', reason, exitCode: null, stoppedAt: '2026-01-01T00:00:00Z' },
    requiredAssertions: { required: 2, passed: 0, failed: 0, unknown: 2 }, thresholds: [] });
}
it.each([
  ['error', 'invalid_config', 'failed'], ['error', 'engine_crash', 'pending'], ['lost', 'execution_lost', 'pending'],
] as const)('maps sealed %s/%s to an error and independent validation %s', (status, reason, validationStatus) => {
  const f = finalizationFixture({ result: incomplete(status, reason) }); f.ready();
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { state: 'errored', outcome: 'inconclusive', validationStatus, reason } });
});

it.each([
  { exitCode: null, oomKilled: false }, { exitCode: 0, oomKilled: null },
  { exitCode: null, oomKilled: null }, { exitCode: 0, oomKilled: false, reason: 'cancelled' },
] as const)('retains unknown or contradictory wrapper evidence as pending %j', exit => {
  const f = finalizationFixture(); f.adopt(); f.release({ exitEvidence: { ...exit, observedAt: '2026-01-01T00:01:00Z' } });
  f.ingest(); f.confirm(); const usage = f.usage();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'exit_evidence' });
  expect(f.usage()).toBe(usage);
});

it('does not settle sealed loss without sufficient wrapper facts, and persisted cancellation wins after custody gates', () => {
  const f = finalizationFixture({ result: incomplete('lost', 'execution_lost') }); f.adopt();
  f.release({ exitEvidence: { exitCode: null, oomKilled: null, observedAt: '2026-01-01T00:01:00Z' } }); f.ingest(); f.confirm();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'exit_evidence' });
  f.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: {
    state: 'cancelled', outcome: 'inconclusive', validationStatus: 'pending', reason: 'cancelled' } });
  const g = finalizationFixture(); g.adopt(); g.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
  expect(g.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
});
