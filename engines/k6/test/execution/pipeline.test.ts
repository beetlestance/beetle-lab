import { expect, it } from 'vitest';
import { runCompiledK6 } from '../../wrapper/execution/index.js';
import { launch, observation, setup, signal, summary, encoded } from './fixtures.js';

it('composes exact numeric profiles, excludes preparation and collects without interpreting test outcome', async () => {
  const f = setup(); const operation = launch(f.options, f.ports);
  const receipt = await operation.result; await operation.quiesced;
  expect(receipt).toMatchObject({ ok: true, terminalObservedAt: '1970-01-01T00:00:02.000Z',
    process: { state: 'stopped', collection: 'complete' }, build: { bytes: 100, peakBytes: 200 }, metricFailure: null });
  expect(f.markers).toEqual([{ sourceTimeMs: 1000, observedAt: '1970-01-01T00:00:02.000Z', build: { bytes: 100, peakBytes: 200 } }]);
  expect(receipt.metrics!.totals).toHaveLength(1);
  expect(receipt.metrics!.totals[0]).toMatchObject({ metric: 'http_reqs', total: { kind: 'counter', sum: 1 }, scope: 'execute' });
  expect(receipt.metrics!.windowCoverage.complete).toBe(true);
  expect(receipt.process!.metricBytes).toBe(receipt.stream!.bytes);
  expect(f.windows).toHaveLength(1);
  expect(f.state).toMatchObject({ built: 1, created: 1, ran: 1, nativeClosed: 1, collected: 1, summaryClosed: 1 });
  expect(f.nativeOptions()).toMatchObject({ attempt: f.options.compiled.attempt, maxMetricStreamBytes: 1_048_576 });
  expect(Object.isFrozen(receipt)).toBe(true);
});
it('does not call native exit99 a passing or failing test', async () => {
  const f = setup();
  const native = f.ports.native;
  const operation = launch(f.options, { ...f.ports, native: input => {
    const child = native(input); return { ...child, run: async () => Object.freeze({ ...await child.run(), exitCode: 99 }) };
  } });
  expect(await operation.result).toMatchObject({ ok: true, process: { exitCode: 99 } });
  await operation.quiesced;
});
it('collects an allowed partial native summary without upgrading numeric completeness', async () => {
  const f = setup();
  const operation = launch(f.options, { ...f.ports,
    native: () => ({ run: async () => observation({ collection: 'partial', cause: 'stream' }), close: async () => {} }) });
  expect(await operation.result).toMatchObject({ ok: false, code: 'native', metrics: null, stream: null,
    summary: { ok: true, evidence: { nativeCollection: 'partial' } } });
  await operation.quiesced;
});
it('does not invent a process observation when the builder fails', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports, build: async () => { throw new Error('private-canary'); } });
  expect(await operation.result).toMatchObject({ ok: false, code: 'build', build: null, process: null, terminalObservedAt: null });
  expect(JSON.stringify(await operation.result)).not.toContain('private-canary');
  await operation.quiesced; expect(f.state.created).toBe(0);
});
it('publishes an actual never-started native observation without invoking the summary collector', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports,
    native: () => ({ run: async () => observation({ spawned: false, state: 'not_started', groupAbsent: false,
      stdioClosed: false, exitCode: null, cause: 'spawn', collection: 'partial' }), close: async () => {} }) });
  expect(await operation.result).toMatchObject({ ok: false, code: 'native', terminalObservedAt: '1970-01-01T00:00:02.000Z',
    process: { state: 'not_started' }, summary: null });
  await operation.quiesced; expect(f.state.collected).toBe(0);
});
it('retains decoder failure and a valid post-stop summary without fabricating numeric totals', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports, native: input => ({
    run: async () => {
      const bytes = new TextEncoder().encode('secret-invalid\n');
      try { await input.sink(bytes, { signal: signal(), deadlineMs: 10_000 }); }
      catch { return observation({ cause: 'sink', collection: 'partial', metricBytes: bytes.byteLength }); }
      throw new Error('Expected the decoder to reject');
    }, close: async () => {},
  }) });
  const receipt = await operation.result;
  expect(receipt).toMatchObject({ ok: false, code: 'metrics', metricFailure: { source: 'decoder', code: 'invalid_record' },
    metrics: null, summary: { ok: true } });
  expect(JSON.stringify(receipt)).not.toContain('secret-invalid'); await operation.quiesced;
});
it('collects summary after a torn stream but never reports complete numeric evidence', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports, native: input => ({ run: async () => {
    const bytes = encoded([{ metric: 'beetle_measure_started', value: 1, timeMs: 1000 }]);
    await input.sink(bytes.subarray(0, bytes.length - 1), { signal: signal(), deadlineMs: 10_000 });
    return observation({ metricBytes: bytes.byteLength - 1 });
  }, close: async () => {} }) });
  expect(await operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'decoder', code: 'torn_record' }, summary: { ok: true } });
  await operation.quiesced;
});
it('publishes a typed failed collector result without exposing private filesystem errors', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports,
    summary: () => ({ ...summary(), result: Promise.resolve({ ok: false, code: 'integrity', closeFailed: false }) }) });
  expect(await operation.result).toMatchObject({ ok: false, code: 'summary', summary: { ok: false, code: 'integrity' } });
  await operation.quiesced;
});
it('returns a bounded public profile failure rather than exposing invalid trusted launch input', async () => {
  const f = setup(); const operation = runCompiledK6({ ...f.options, outputDirectory: 'private-canary' });
  expect(await operation.result).toMatchObject({ ok: false, code: 'profile', process: null });
  expect(JSON.stringify(await operation.result)).not.toContain('private-canary');
  expect(operation.close()).toBe(operation.close()); await operation.quiesced;
});
