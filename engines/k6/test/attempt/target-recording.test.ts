import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, native, resetNative } from './fixtures.js';
import { MemoryMailbox } from './live-fixtures.js';
import { reserveOutput, phaseReservation } from '../../wrapper/attempt/reservation.js';
import { AppendFiles } from '../../wrapper/artifact-custody/index.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';

const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() {
  const f = await fixture(); cleanups.push(f.cleanup);
  (f.offer.config as SuiteConfig).targetSampling = { path: '/stats', intervalMs: 1000, timeoutMs: 100, cooldownMs: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"rss":1234}'));
  await f.save(); return f;
}
it('records all retained target samples during execute, without changing sealed result authority', async () => {
  const f = await setup(); const file = new MemoryMailbox();
  const receipt = await f.run({ liveMetricMailbox: true }, { openMailbox: async () => file });
  expect(receipt.ok).toBe(true);
  const path = join(f.outputRoot, 'target-samples.ndjson'); const archive = await readFile(path);
  const records = archive.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const report = JSON.parse(await readFile(join(f.outputRoot, 'target-runtime.json'), 'utf8'));
  expect(records[0]).toMatchObject({ format: 'beetle-target-samples', version: 1, scope: receipt.scope, intervalMs: 1000 });
  expect(records.slice(1).map(row => row.sample)).toEqual(report.samples);
  expect(records.slice(1).map(row => row.sequence)).toEqual(report.samples.map((_sample: unknown, index: number) => index + 1));
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(receipt.result!.artifacts.some(artifact => artifact.relativePath === 'target-samples.ndjson')).toBe(false);
  const events = (await readFile(join(f.outputRoot, 'control.ndjson'), 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  const prepare = events.find(event => event.kind === 'phase.finished' && event.phase === 'prepare');
  const execute = events.find(event => event.kind === 'phase.finished' && event.phase === 'execute');
  expect(prepare.payload.outputBytes).toBe(29);
  expect(execute.payload.outputBytes).toBeGreaterThanOrEqual(archive.length + receipt.liveMetrics.producedBytes);
});
it.each(['disabled', 'unmeasured'] as const)('does not create an active archive when %s', async mode => {
  const f = await setup(); if (mode === 'unmeasured') native.missingMarker = true;
  const receipt = await f.run({ liveMetricMailbox: mode !== 'disabled' }, { openMailbox: async () => new MemoryMailbox() });
  expect(receipt.ok).toBe(mode === 'disabled');
  if (mode === 'unmeasured') expect(receipt.result?.outcome).toBe('inconclusive');
  await expect(stat(join(f.outputRoot, 'target-samples.ndjson'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(receipt.result!.artifacts.some(artifact => artifact.kind === 'target-runtime')).toBe(true);
});
it('carves the active archive from both the accepted output and the execute allowance', async () => {
  const f = await setup(); const total = f.offer.budget.outputBytes;
  const disabled = reserveOutput(total, true, false); const sampled = reserveOutput(total, true, true);
  const reserved = phaseReservation(sampled, f.manifest);
  expect(disabled.targetHistory).toBe(0); expect(sampled.targetHistory).toBe(1048576);
  expect(reserved.control + reserved.numeric + reserved.warnings + reserved.diagnostics + reserved.result + reserved.execution + reserved.target + reserved.live + reserved.reports).toBeLessThanOrEqual(total);
  expect(reserved.history + 1048576 + reserved.live + reserved.targetHistory).toBeLessThanOrEqual(f.manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes);
  f.manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes = 2 * 1048576;
  expect(() => phaseReservation(sampled, f.manifest)).toThrow('output_limit');
});
it('fails recording before native load continues instead of silently losing target history', async () => {
  const f = await setup(); const append = AppendFiles.prototype.append;
  vi.spyOn(AppendFiles.prototype, 'append').mockImplementation(async function(this: AppendFiles, lane, bytes) {
    if (Buffer.from(bytes).toString().includes('beetle-target-samples')) throw new Error('synthetic recording failure');
    return append.call(this, lane, bytes);
  });
  const receipt = await f.run({ liveMetricMailbox: true }, { openMailbox: async () => new MemoryMailbox() });
  expect(receipt.ok).toBe(false); expect(receipt.reason).toBe('artifact'); expect(receipt.result).toBeNull();
  expect(receipt.quiescence.artifacts).toBe('failed');
});
it('blocks sealing when the target archive original close fails', async () => {
  const f = await setup(); const close = AppendFiles.prototype.close;
  vi.spyOn(AppendFiles.prototype, 'close').mockImplementation(async function(this: AppendFiles) {
    await close.call(this); throw Error('synthetic original close failure');
  });
  const receipt = await f.run({ liveMetricMailbox: true }, { openMailbox: async () => new MemoryMailbox() });
  expect(receipt.ok).toBe(false); expect(receipt.reason).toBe('cleanup'); expect(receipt.result).toBeNull();
  expect(receipt.quiescence.artifacts).toBe('failed');
});
