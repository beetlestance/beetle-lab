import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sealEngineResult, verifyEngineResultSeal } from '@beetle/contracts';
import type { ControlEvent } from '@beetle/contracts';
import { MetricArchive } from '../../wrapper/attempt/archive/index.js';
import { AttemptError } from '../../wrapper/attempt/types.js';
import { MetricFiles } from '../../wrapper/attempt/archive/files.js';
import { replayControl } from '../../wrapper/control/index.js';
import { fixture, native, resetNative } from './fixtures.js';
import { discoveryConfig } from '../result/fixtures.js';
import { syntheticInstalledIdentity } from '../staged-input/fixtures.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';

const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => { await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() { const value = await fixture(); cleanups.push(value.cleanup); return value; }
function prepareOutput(events: readonly ControlEvent[]) {
  return events.find(event => event.kind === 'phase.finished' && event.phase === 'prepare')?.payload;
}
it('accounts execute history and collect final drain separately through real staged composition', async () => {
  const f = await setup(); native.metricOffsets = [0, 3000, 6000];
  for (const phase of f.manifest.phases) phase.timeoutMs = 30_000;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest); await f.save();
  const events: ControlEvent[] = [];
  const receipt = await f.run({ onEvent: async event => { events.push(event); } });
  expect(receipt.ok, JSON.stringify(receipt)).toBe(true); expect(native.calls).toBe(1);
  const data = (await readFile(join(f.outputRoot, 'metric-windows.ndjson'), 'utf8')).trimEnd().split('\n');
  const index = (await readFile(join(f.outputRoot, 'metric-index.ndjson'), 'utf8')).trimEnd().split('\n');
  expect(data).toHaveLength(5); expect(index).toHaveLength(5);
  for (let i = 1; i <= 3; i++) expect(JSON.parse(data[i]!)).toMatchObject({ sequence: i, window: {
    series: [expect.objectContaining({ total: expect.objectContaining({ count: 1, min: 3, max: 3 }) })],
  } });
  // Two occupied windows flush during native input; the third drains after collect starts.
  const executeBytes = Buffer.byteLength(data.slice(0, 3).join('\n') + '\n')
    + Buffer.byteLength(index.slice(0, 3).join('\n') + '\n');
  expect(events.find(event => event.kind === 'phase.finished' && event.phase === 'execute'))
    .toMatchObject({ payload: { outputBytes: executeBytes } });
  const total = receipt.result!.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  expect(events.find(event => event.kind === 'phase.finished' && event.phase === 'collect'))
    .toMatchObject({ payload: { outputBytes: total - executeBytes } });
  expect(Object.values(receipt.quiescence).every(value => value === 'confirmed')).toBe(true);
});
it.each([true, false])('publishes bounded reports only for a confirmed paired-window cap (%s)', async pairedCap => {
  const f = await setup();
  native.observeSinkStop = true;
  native.metricOffsets = Array.from({ length: 450 }, (_, index) => index * 1000);
  f.manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes = 1_048_576 + 65_536;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest);
  await f.save();
  // In the paired-cap case the real producer exhausts the 64 KiB archive allowance.
  const rejectUnknown = pairedCap ? undefined : vi.spyOn(MetricArchive.prototype, 'append')
    .mockRejectedValueOnce(new AttemptError('output_limit'));
  try {
    const events: ControlEvent[] = [];
    const receipt = await f.run({ onEvent: async event => { events.push(event); } });
    expect(receipt).toMatchObject({
      ok: false, reason: 'output_limit',
      execution: { ok: false, code: 'metrics', process: { cause: 'sink' }, metrics: null },
    });
    if (!pairedCap) {
      expect(receipt.result).toBeNull();
      return;
    }
    const retainedBytes = (await stat(join(f.outputRoot, 'metric-windows.ndjson'))).size
      + (await stat(join(f.outputRoot, 'metric-index.ndjson'))).size;
    expect(retainedBytes).toBeGreaterThan(60_000);
    expect(retainedBytes).toBeLessThanOrEqual(65_536);
    for (const name of ['metric-windows.ndjson', 'metric-index.ndjson']) {
      const rows = (await readFile(join(f.outputRoot, name), 'utf8')).trimEnd().split('\n');
      expect(JSON.parse(rows.at(-1)!)).not.toMatchObject({ kind: 'end' });
    }
    expect(events.find(event => event.kind === 'phase.finished' && event.phase === 'execute'))
      .toMatchObject({ payload: { outputBytes: retainedBytes } });
    expect(receipt.publication?.ok).toBe(true);
    expect(receipt.result).toMatchObject({ outcome: 'inconclusive', execution: { status: 'error', reason: 'output_limit' } });
    const artifacts = receipt.result!.artifacts;
    expect(artifacts.map(artifact => artifact.kind)).toEqual(['numeric-final', 'performance-report', 'metrics-csv']);
    expect(events.find(event => event.kind === 'phase.finished' && event.phase === 'collect'))
      .toMatchObject({ payload: { outputBytes: artifacts.reduce((bytes, artifact) => bytes + artifact.bytes, 0) } });
    expect(events.find(event => event.kind === 'phase.finished' && event.phase === 'seal'))
      .toMatchObject({ payload: { outputBytes: await stat(join(f.outputRoot, 'engine-result.json')).then(value => value.size) } });
    const report = artifacts[1]!;
    expect(createHash('sha256').update(await readFile(join(f.outputRoot, report.relativePath))).digest('hex'))
      .toBe(report.sha256);
    const numeric = JSON.parse(await readFile(join(f.outputRoot, 'numeric-final.json'), 'utf8'));
    expect(numeric).toMatchObject({ metrics: null, windowsRetained: false, history: null });
  } finally {
    rejectUnknown?.mockRestore();
  }
});
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
  expect(numeric.windowsRetained).toBe(true); expect(numeric.quantiles).toBe('histogram-estimate'); expect(numeric.version).toBe(4); expect(numeric.timing).toEqual({ testRunDurationMs: 1000 });
  expect(numeric.metrics).toMatchObject({ quantiles: 'histogram-estimate', totals: [expect.objectContaining({
    metric: 'http_req_duration', total: expect.objectContaining({ kind: 'trend', count: 1,
      distribution: expect.objectContaining({ format: 'exponential-v1', unit: 'ms', count: 1, min: 3, max: 3 }) }),
  })] });
  expect(numeric.history).toMatchObject({ windows: 1,
    dataArtifactId: result.artifacts.find(artifact => artifact.kind === 'metric-windows')!.artifactId,
    indexArtifactId: result.artifacts.find(artifact => artifact.kind === 'metric-index')!.artifactId });
  const history = (await readFile(join(f.outputRoot, 'metric-windows.ndjson'), 'utf8')).trimEnd().split('\n');
  expect(history).toHaveLength(3);
  expect(JSON.parse(history[1]!)).toMatchObject({ sequence: 1, window: { series: [expect.objectContaining({
    metric: 'http_req_duration', total: expect.objectContaining({ count: 1, min: 3, max: 3 }),
  })] } });
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

it('keeps sealed native evidence and withholds a same-length damaged archive', async () => {
  const f = await setup();
  const original = MetricFiles.prototype.verify;
  const verify = vi.spyOn(MetricFiles.prototype, 'verify').mockImplementationOnce(async function (this: MetricFiles, lane, expected) {
    const file = await open(join(f.outputRoot, 'metric-windows.ndjson'), 'r+');
    try {
      await file.write(Buffer.from('X'), 0, 1, 0);
    } finally {
      await file.close();
    }
    return original.call(this, lane, expected);
  });
  try {
    const events: ControlEvent[] = [];
    const receipt = await f.run({ onEvent: async (event) => { events.push(event); } });
    expect(receipt.ok, JSON.stringify(receipt)).toBe(true);
    const result = receipt.result!;
    expect(result).toMatchObject({
      outcome: 'inconclusive',
      completeness: 'partial',
      execution: { status: 'error', reason: 'artifact_incomplete' },
    });
    expect(verifyEngineResultSeal(result, text => createHash('sha256').update(text).digest('hex')).ok).toBe(true);
    expect(result.artifacts.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['native-summary', 'numeric-final', 'performance-report', 'metrics-csv']));
    expect(result.artifacts.some(({ kind }) => kind === 'metric-windows' || kind === 'metric-index')).toBe(false);
    for (const artifact of result.artifacts) {
      const bytes = await readFile(join(f.outputRoot, artifact.relativePath));
      expect(bytes.byteLength).toBe(artifact.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    }
    const numeric = JSON.parse(await readFile(join(f.outputRoot, 'numeric-final.json'), 'utf8'));
    const report = result.artifacts.find(({ kind }) => kind === 'performance-report')!;
    const reportText = await readFile(join(f.outputRoot, report.relativePath), 'utf8');
    const summary = result.artifacts.find(({ kind }) => kind === 'native-summary')!;
    expect(result.nativeOverview).toMatchObject({ summarySha256: summary.sha256, durationMs: 1000, p95Ms: 1 });
    const { seal, ...body } = result;
    const unbound = { ...body, nativeOverview: { ...body.nativeOverview!, summarySha256: 'f'.repeat(64) } };
    expect(sealEngineResult(unbound, seal.sealedAt, text => createHash('sha256').update(text).digest('hex')))
      .toEqual({ ok: false, code: 'invalid_result' });
    for (const change of [{ bytes: 0 }, { relativePath: 'synthetic.json' }]) {
      const artifacts = body.artifacts.map(artifact => artifact === summary ? { ...artifact, ...change } : artifact);
      expect(sealEngineResult({ ...body, artifacts }, seal.sealedAt, text => createHash('sha256').update(text).digest('hex')))
        .toEqual({ ok: false, code: 'invalid_result' });
    }
    expect(reportText).toContain('Verified native k6 summary.');
    expect(reportText).toContain('p95 latency (ms): 1');
    expect(reportText).toContain('metric window coverage: missing');
    expect(reportText).toContain('Observed metric series: 0.');
    expect(events.find(({ kind }) => kind === 'engine.result')?.payload).toEqual(result);
    expect(events.at(-1)).toMatchObject({ kind: 'phase.finished', phase: 'seal' });
    expect(numeric).toMatchObject({ timing: { testRunDurationMs: 1000 }, metrics: null, windowsRetained: false, history: null });
    const size = async (name: string) => (await stat(join(f.outputRoot, name))).size;
    const archiveBytes = await size('metric-windows.ndjson') + await size('metric-index.ndjson');
    const produced = events.filter((event) => event.kind === 'phase.finished' && ['execute', 'collect'].includes(event.phase))
      .reduce((bytes, event) => bytes + (event.kind === 'phase.finished' ? event.payload.outputBytes : 0), 0);
    expect(produced).toBe(archiveBytes + result.artifacts.reduce((bytes, artifact) => bytes + artifact.bytes, 0));
    expect((await readFile(join(f.outputRoot, 'metric-windows.ndjson'), 'utf8')).startsWith('X')).toBe(true);
  } finally {
    verify.mockRestore();
  }
});
