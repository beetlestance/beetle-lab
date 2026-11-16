import { expect, it } from 'vitest';
import type { ExecutionOptions } from '../../wrapper/execution/index.js';
import { encoded, launch, measured, observation, setup, signal } from './fixtures.js';

function streamed(bytes: Uint8Array, change: Partial<ExecutionOptions> = {}) {
  const f = setup();
  const operation = launch({ ...f.options, ...change }, { ...f.ports, native: input => ({ run: async () => {
    try { await input.sink(bytes, { signal: input.signal ?? signal(), deadlineMs: 10_000 }); return observation({ metricBytes: bytes.byteLength }); }
    catch { return observation({ cause: 'sink', collection: 'partial', metricBytes: bytes.byteLength }); }
  }, close: async () => {} }) });
  return { ...f, operation };
}
it('requires one reserved byte for every admitted raw byte and record while retaining backpressure', async () => {
  const f = setup(); const bytes = measured(); const rawRecords = new TextDecoder().decode(bytes).trim().split('\n').length;
  const exact = streamed(bytes, { limits: { ...f.options.limits, maximumMetricBytes: bytes.byteLength, maximumMetricRecords: rawRecords } });
  const receipt = await exact.operation.result; expect(receipt).toMatchObject({ ok: true,
    stream: { bytes: bytes.byteLength, records: rawRecords } }); await exact.operation.quiesced;
  const short = streamed(bytes, { limits: { ...f.options.limits, maximumMetricBytes: bytes.byteLength - 1 } });
  expect(await short.operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'decoder', code: 'stream_limit' } }); await short.operation.quiesced;
});
it('rejects complete-source byte conservation mismatch while preserving both observed counters', async () => {
  const f = setup(); const bytes = measured();
  const operation = launch(f.options, { ...f.ports, native: input => ({ run: async () => {
    await input.sink(bytes, { signal: input.signal ?? signal(), deadlineMs: 10_000 });
    return observation({ metricBytes: bytes.byteLength + 1 });
  }, close: async () => {} }) });
  expect(await operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'composition', code: 'byte_count' }, stream: { bytes: bytes.byteLength },
    process: { metricBytes: bytes.byteLength + 1 }, summary: { ok: true } });
  await operation.quiesced;
});
it('rejects parser record overflow without inventing a measurement marker', async () => {
  const f = setup(); const h = streamed(measured(), { limits: { ...f.options.limits, maximumMetricRecords: 1 } });
  expect(await h.operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'decoder', code: 'record_limit' } });
  expect(h.markers).toEqual([]); await h.operation.quiesced;
});
it('enforces the existing decoder line bound through the composed native sink', async () => {
  const h = streamed(new TextEncoder().encode('x'.repeat(65_537) + '\n'));
  expect(await h.operation.result).toMatchObject({ ok: false, code: 'metrics',
    metricFailure: { source: 'decoder', code: 'line_limit' } }); await h.operation.quiesced;
});
it.each([0, 2])('rejects marker value%s before publishing retrospective measurement', async value => {
  const h = streamed(encoded([{ metric: 'beetle_measure_started', value, timeMs: 1000 }]));
  expect(await h.operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'accumulator', code: 'measurement' } });
  expect(h.markers).toEqual([]); await h.operation.quiesced;
});
it('publishes one marker callback and rejects a duplicate instead of repeating the control notification', async () => {
  const h = streamed(encoded([{ metric: 'beetle_measure_started', value: 1, timeMs: 1000 },
    { metric: 'beetle_measure_started', value: 1, timeMs: 1000 }]));
  expect(await h.operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'accumulator', code: 'measurement' } });
  expect(h.markers).toHaveLength(1); await h.operation.quiesced;
});
it('requires an actual source marker even when the native process reported complete output', async () => {
  const h = streamed(encoded([{ metric: 'http_reqs', value: 1, timeMs: 1100, tags: { phase: 'execute', request: 'r0' } }]));
  expect(await h.operation.result).toMatchObject({ ok: false, code: 'metrics', metrics: null,
    metricFailure: { source: 'accumulator', code: 'measurement' }, summary: { ok: true } });
  expect(h.markers).toEqual([]); await h.operation.quiesced;
});
it('rejects an impossible preparation/request combination using the exact production profile', async () => {
  const h = streamed(encoded([{ metric: 'http_reqs', value: 1, timeMs: 1000, tags: { phase: 'prepare', request: 'r0' } }]));
  expect(await h.operation.result).toMatchObject({ ok: false, code: 'metrics',
    metricFailure: { source: 'decoder', code: 'invalid_labels' } }); await h.operation.quiesced;
});
it('retains bounded callback failure evidence rather than callback error text', async () => {
  const h = streamed(measured(), { measureStarted: async () => { throw new Error('private-marker-canary'); } });
  const receipt = await h.operation.result;
  expect(receipt).toMatchObject({ ok: false, code: 'metrics', metricFailure: { source: 'callback', code: 'sink_failed' } });
  expect(JSON.stringify(receipt)).not.toContain('private-marker-canary'); await h.operation.quiesced;
});
it('rejects final window persistence failure and preserves summary evidence separately', async () => {
  const h = streamed(measured(), { window: async () => { throw new Error('private-window-canary'); } });
  const receipt = await h.operation.result;
  expect(receipt).toMatchObject({ ok: false, code: 'metrics', metrics: null, stream: { records: 5 },
    metricFailure: { source: 'callback', code: 'sink_failed' }, summary: { ok: true } });
  expect(JSON.stringify(receipt)).not.toContain('private-window-canary'); await h.operation.quiesced;
});
it.each([{ scriptPath: '/other/suite.js', bytes: 100, peakBytes: 200 },
  { scriptPath: '/owned/output/suite.js', bytes: 300, peakBytes: 200 },
  { scriptPath: '/owned/output/suite.js', bytes: 100, peakBytes: 65_537 },
  { scriptPath: '/owned/output/suite.js', bytes: NaN, peakBytes: 200 }])('rejects an invalid builder receipt before native launch %j', async build => {
  const f = setup(); const operation = launch(f.options, { ...f.ports, build: async () => build });
  expect(await operation.result).toMatchObject({ ok: false, code: 'build', process: null });
  await operation.quiesced; expect(f.state.created).toBe(0);
});
