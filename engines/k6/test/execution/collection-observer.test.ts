import { expect, it } from 'vitest';
import type { ExecutionOptions } from '../../wrapper/execution/index.js';
import { ExecutionError } from '../../wrapper/execution/index.js';
import type { Execution } from '../../wrapper/execution/operation.js';
import { deferred, flush, launch, observation, setup } from './fixtures.js';

it('notifies after actual stop and before final numeric drain or summary I/O', async () => {
  const f = setup(); const steps: string[] = [];
  const native = f.ports.native; const summary = f.ports.summary;
  const operation = launch({ ...f.options, window: async () => { steps.push('window'); },
    collectStarted: async receipt => {
      steps.push('collect'); expect(Object.isFrozen(receipt)).toBe(true);
      expect(receipt).toEqual({ observedAt: '1970-01-01T00:00:02.000Z', terminalObservedAt: '1970-01-01T00:00:02.000Z' });
    } }, { ...f.ports, native: input => {
    const child = native(input); return { ...child, run: async () => { const result = await child.run(); steps.push('stopped'); return result; } };
  }, summary: input => { steps.push('summary'); return summary(input); } });
  expect((await operation.final).ok).toBe(true); await operation.quiesced;
  expect(steps).toEqual(['stopped', 'collect', 'window', 'summary']);
});

it('retains a blocked observer through cancellation without issuing collection work', async () => {
  const f = setup(); const cancel = new AbortController(); const entered = deferred(); const gate = deferred();
  let sinkSignal: AbortSignal | undefined;
  const operation = launch({ ...f.options, signal: cancel.signal, collectStarted: async (_receipt, signal) => {
    sinkSignal = signal; entered.resolve(); await gate.promise;
  } }, f.ports);
  await entered.promise; cancel.abort();
  expect(await operation.result).toMatchObject({ ok: false, code: 'cancelled', process: { state: 'stopped' } });
  expect(sinkSignal?.aborted).toBe(true); expect(f.state.collected).toBe(0); expect(f.windows).toEqual([]);
  let final = false; void operation.final.then(() => { final = true; }); await flush(); expect(final).toBe(false);
  gate.resolve(); expect(await operation.final).toMatchObject({ ok: false, code: 'cancelled', summary: null });
  await operation.quiesced; expect(f.state.nativeClosed).toBe(1);
});

it('classifies observer failure without exposing its error or starting summary I/O', async () => {
  const f = setup(); const operation = launch({ ...f.options,
    collectStarted: async () => { throw new Error('private-collection-canary'); } }, f.ports);
  const result = await operation.final;
  expect(result).toMatchObject({ ok: false, code: 'summary', summary: null, metrics: null });
  expect(JSON.stringify(result)).not.toContain('private-collection-canary'); await operation.quiesced;
  expect(f.state.collected).toBe(0); expect(f.state.nativeClosed).toBe(1);
});

it.each(['build', 'native', 'cancelled', 'clock'] as const)('normalizes observer ExecutionError(%s) without trusting its classification', async code => {
  const f = setup(); const operation = launch({ ...f.options,
    collectStarted: async () => { throw new ExecutionError(code); } }, f.ports);
  expect(await operation.final).toMatchObject({ ok: false, code: 'summary', summary: null });
  await operation.quiesced; expect(f.state.collected).toBe(0);
});

it('preserves genuine parent cancellation when an observer also throws', async () => {
  const f = setup(); const cancel = new AbortController();
  const operation = launch({ ...f.options, signal: cancel.signal,
    collectStarted: async () => { cancel.abort(); throw new ExecutionError('build'); } }, f.ports);
  expect(await operation.final).toMatchObject({ ok: false, code: 'cancelled', summary: null });
  await operation.quiesced; expect(f.state.collected).toBe(0);
});

it('captures the observer before caller mutation', async () => {
  const f = setup(); let called = 0;
  const options = { ...f.options, collectStarted: async () => { called++; } };
  const operation = launch(options, f.ports);
  options.collectStarted = async () => { throw new Error('replacement'); };
  expect((await operation.final).ok).toBe(true); await operation.quiesced; expect(called).toBe(1);
});

it('notifies collection for confirmed stopped partial sources without upgrading completeness', async () => {
  const f = setup(); let called = 0;
  const operation = launch({ ...f.options, collectStarted: async () => { called++; } }, { ...f.ports,
    native: () => ({ run: async () => observation({ collection: 'partial', cause: 'stream' }), close: async () => {} }) });
  expect(await operation.final).toMatchObject({ ok: false, code: 'native', metrics: null,
    summary: { ok: true, evidence: { nativeCollection: 'partial' } } });
  await operation.quiesced; expect(called).toBe(1);
});

it.each([false, true])('does not notify for unconfirmed stop or never-started work (%s)', async neverStarted => {
  const f = setup(); let called = 0;
  const process = neverStarted ? observation({ spawned: false, state: 'not_started', groupAbsent: false,
    stdioClosed: false, exitCode: null, cause: 'spawn', collection: 'partial' })
    : observation({ state: 'unknown', groupAbsent: false, quiescent: false, collection: 'partial' });
  const operation = launch({ ...f.options, collectStarted: async () => { called++; } }, { ...f.ports,
    native: () => ({ run: async () => process, close: async () => {} }) });
  expect(await operation.final).toMatchObject({ ok: false, code: 'native' }); await operation.quiesced;
  expect(called).toBe(0); expect(f.state.collected).toBe(0);
});

it('fences synchronous close reentry before collection starts', async () => {
  const f = setup();
  const operation: Execution = launch({ ...f.options, collectStarted: async () => { void operation.close(); } }, f.ports);
  expect(await operation.final).toMatchObject({ ok: false, code: 'closed', summary: null });
  await operation.quiesced; expect(f.state.collected).toBe(0); expect(f.state.nativeClosed).toBe(1);
});

it.each([null, 0, {}, 'handler'])('rejects invalid optional observer %s before build', value => {
  const f = setup(); expect(() => launch({ ...f.options,
    collectStarted: value as unknown as NonNullable<ExecutionOptions['collectStarted']> }, f.ports)).toThrow('Native execution boundary rejected');
  expect(f.state.built).toBe(0);
});
