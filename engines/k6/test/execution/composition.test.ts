import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildRuntimeScript } from '../../build/index.js';
import { metricEvidenceLayout } from '../../plan/index.js';
import { readK6Summary } from '../../wrapper/collection/index.js';
import { launch, measured, observation, setup, signal } from './fixtures.js';

it('connects the real bounded builder, decoder, accumulator and filesystem summary collector around a synthetic native boundary', async () => {
  const directory = await mkdtemp('/private/tmp/beetle-execution-composition-');
  const f = setup();
  const layout = metricEvidenceLayout(f.options.compiled.suite);
  const metrics = Object.fromEntries(layout.metrics.map(metric => [metric.key, {
    nativeKey: metric.nativeKey, scope: metric.scope, provenance: metric.provenance,
    values: ['http_reqs', 'beetle_measure_started'].includes(metric.key) ? { count: 1, rate: 10 }
      : ['beetle_required_failures', 'beetle_execution_failures'].includes(metric.key) ? { count: 0, rate: 0 } : {},
    thresholds: metric.thresholds.map(rule => ({ expression: rule.threshold,
      ok: ['http_reqs', 'beetle_measure_started', 'beetle_required_failures', 'beetle_execution_failures'].includes(metric.key) ? true : null })),
  }]));
  const raw = JSON.stringify({ version: 2, timing: { testRunDurationMs: 100 }, metrics });
  const operation = launch({ ...f.options, outputDirectory: directory, uid: process.getuid!() }, {
    build: buildRuntimeScript, summary: readK6Summary, native: input => ({ run: async () => {
      expect((await readFile(input.script, 'utf8'))).toContain('k6/http');
      await writeFile(join(directory, 'beetle-evidence.json'), raw, { flag: 'wx', mode: 0o600 });
      const bytes = measured(); await input.sink(bytes, { signal: input.signal ?? signal(), deadlineMs: 10_000 });
      return observation({ metricBytes: bytes.byteLength });
    }, close: async () => {} }),
  });
  try {
    const receipt = await operation.result; await operation.quiesced;
    expect(receipt).toMatchObject({ ok: true, summary: { ok: true, evidence: { rawBytes: Buffer.byteLength(raw),
      version: 2, nativeCollection: 'complete', metrics: { http_reqs: { values: { count: 1 } } } } } });
    expect(receipt.build!.bytes).toBe((await stat(join(directory, 'suite.js'))).size);
    expect(receipt.build!.peakBytes).toBeLessThanOrEqual(f.options.limits.maximumBuildBytes);
    expect(await readdir(directory)).toEqual(['beetle-evidence.json', 'suite.js']);
    expect(receipt.metrics!.measurement).toEqual({ complete: true, sourceTimeMs: 1000 });
  } finally { await operation.close(); await rm(directory, { recursive: true, force: true }); }
});
