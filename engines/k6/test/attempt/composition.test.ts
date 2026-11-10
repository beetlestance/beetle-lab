import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { verifyEngineResultSeal } from '@beetle/contracts';
import type { ControlEvent } from '@beetle/contracts';
import { replayControl } from '../../wrapper/control/index.js';
import { fixture, native, resetNative } from './fixtures.js';
import { discoveryConfig } from '../result/fixtures.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';

const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => { await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() { const value = await fixture(); cleanups.push(value.cleanup); return value; }
function prepareOutput(events: readonly ControlEvent[]) {
  return events.find(event => event.kind === 'phase.finished' && event.phase === 'prepare')?.payload;
}
it.each([false, true])('composes actual compiler/execution/parser/collector/mapper/seal/publication (required failure %s)', async failed => {
  const f = await setup(); native.failed = failed;
  const events: ControlEvent[] = [];
  const receipt = await f.run({ onEvent: async event => {
    events.push(event);
    if (event.kind === 'engine.result') expect(JSON.parse(await readFile(join(f.outputRoot, 'engine-result.json'), 'utf8'))).toEqual(event.payload);
  } });
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  expect(receipt.result?.outcome).toBe(failed ? 'failed' : 'passed');
  expect(receipt.result?.execution.exitCode).toBe(failed ? 99 : 0);
  expect(receipt.result?.requiredAssertions).toEqual({ required: 1, passed: failed ? 0 : 1, failed: failed ? 1 : 0, unknown: 0 });
  expect(native.calls).toBe(1); expect(native.closes).toBe(1);
  expect(events.filter(event => event.kind === 'phase.started').map(event => event.phase)).toEqual(['validate', 'prepare', 'execute', 'collect', 'seal']);
  expect(events.at(-1)?.kind).toBe('phase.finished');
  expect(prepareOutput(events)).toEqual({ completedUnits: 1, outputBytes: 29 });
  expect(Object.values(receipt.quiescence).every(value => value === 'confirmed')).toBe(true);
  const result = receipt.result!;
  expect(verifyEngineResultSeal(result, text => createHash('sha256').update(text).digest('hex')).ok).toBe(true);
  for (const artifact of result.artifacts) {
    const path = join(f.outputRoot, artifact.relativePath); const bytes = await readFile(path);
    expect(bytes.length).toBe(artifact.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
  const numeric = JSON.parse(await readFile(join(f.outputRoot, 'numeric-final.json'), 'utf8')) as Record<string, unknown>;
  expect(numeric.windowsRetained).toBe(false); expect(numeric.quantiles).toBe('histogram-estimate'); expect(numeric.version).toBe(2);
  expect(numeric.metrics).toMatchObject({ quantiles: 'histogram-estimate', totals: [expect.objectContaining({
    metric: 'http_req_duration', total: expect.objectContaining({ kind: 'trend', count: 1,
      distribution: expect.objectContaining({ format: 'exponential-v1', unit: 'ms', count: 1, min: 3, max: 3 }) }),
  })] });
  expect(numeric.buildUsage).toEqual({ bytes: 29, peakBytes: 100 });
  expect(numeric.diagnostics).toEqual({ windowCoverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } });
  expect(JSON.stringify(receipt) + JSON.stringify(events)).not.toContain('SECRET');
  const replay = await replayControl({ directory: f.outputRoot, scope: receipt.scope!, quotaBytes: 262_144, after: 0 },
    { deadline: performance.now() + 1000 });
  expect(replay.events).toEqual(events);
  const duplicate = await f.run(); expect(duplicate.ok).toBe(false); expect(native.calls).toBe(1);
});
it('retains native exit0 with missing marker as inconclusive, without inventing execute phase', async () => {
  const f = await setup(); native.missingMarker = true; const phases: string[] = []; let prepareBytes = -1;
  const result = await f.run({ onEvent: async event => {
    if (event.kind === 'phase.started') phases.push(event.phase);
    if (event.kind === 'phase.finished' && event.phase === 'prepare') prepareBytes = event.payload.outputBytes;
  } });
  expect(result.ok).toBe(false); expect(result.result?.outcome).toBe('inconclusive');
  expect(result.result?.completeness).toBe('partial'); expect(phases).toEqual(['validate', 'prepare', 'collect', 'seal']);
  expect(prepareBytes).toBe(29);
});
it('disables rejected notifications but preserves durable journal and published result', async () => {
  const f = await setup(); let calls = 0;
  const result = await f.run({ onEvent: async () => { calls++; throw new Error('SECRET_NOTIFY'); } });
  expect(calls).toBe(1); expect(result.ok).toBe(false); expect(result.notifications).toBe('failed');
  expect(result.publication?.ok).toBe(true); expect(result.result?.outcome).toBe('passed');
  const replay = await replayControl({ directory: f.outputRoot, scope: result.scope!, quotaBytes: 262_144, after: 0 },
    { deadline: performance.now() + 1000 });
  expect(replay.events.some(event => event.kind === 'engine.result')).toBe(true);
});
it('preserves discovery native99 witness semantics through the real mapper', async () => {
  const f = await setup(); native.discovery = true;
  (f.offer.config as SuiteConfig).loadPlan = discoveryConfig().loadPlan; await f.save();
  const receipt = await f.run();
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
  expect(receipt.result).toMatchObject({ mode: 'discovery', outcome: 'passed', execution: { exitCode: 99 },
    expectedAbort: { ruleId: 'stop', reached: true } });
});
