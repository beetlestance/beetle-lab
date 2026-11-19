import {gunzipSync} from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureMailboxImage, MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import { decodeLiveMetricSnapshot } from '@beetle/contracts/api';
import { K6_HISTORY_CHECKPOINT_NAMES } from '@beetle/contracts/k6-live';
import { CHECKPOINT_ALLOWANCE } from '../../wrapper/attempt/history-checkpoint.js';
import { fixture, native, resetNative } from './fixtures.js';
import { deferred, MemoryMailbox } from './live-fixtures.js';
import { reserveOutput, phaseReservation } from '../../wrapper/attempt/reservation.js';
import { AppendFiles } from '../../wrapper/artifact-custody/index.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => {vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(clean => clean()));});
async function setup() {const value = await fixture(); cleanups.push(value.cleanup); return value;}
function observeCheckpoint() {
  const completed = deferred();
  const replace = AppendFiles.prototype.replaceCheckpoint;
  vi.spyOn(AppendFiles.prototype, 'replaceCheckpoint').mockImplementation(async function (this: AppendFiles, lane, bytes) {
    await replace.call(this, lane, bytes);
    completed.resolve();
  });
  return completed.promise;
}
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
it('publishes during actual measured window callbacks and drains before sealed history', async () => {
  const f = await setup(); const file = new MemoryMailbox(); native.metricOffsets = [0, 1000, 2000, 3000];
  const checkpoint = observeCheckpoint();
  const receipt = await f.run({liveMetricMailbox: true, onWindow: () => checkpoint}, {openMailbox: async () => file});
  expect(receipt.ok).toBe(true); expect(file.produced).toBeGreaterThan(0); expect(file.closes).toBe(1);
  expect(receipt.liveMetrics).toMatchObject({status: 'closed', quiescence: 'confirmed', producedBytes: MAILBOX_BYTES + file.produced + CHECKPOINT_ALLOWANCE});
  const frame = decodeLiveMetricSnapshot(gunzipSync(captureMailboxImage(file.bytes, hash).frame, {maxOutputLength: 65536}), hash);
  expect(frame.scope).toEqual(receipt.scope); expect(frame.series.some(row => row.metric === 'http_req_duration')).toBe(true);
  const firstCheckpoint = await readFile(join(f.outputRoot, K6_HISTORY_CHECKPOINT_NAMES[0]), 'utf8');
  expect(JSON.parse(firstCheckpoint.split('\n')[0]!).prefix).toMatchObject({ scope: receipt.scope, windows: 1 });
  const events = (await readFile(join(f.outputRoot, 'control.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as {kind: string; phase: string; payload: {outputBytes: number}});
  const execute = events.find(event => event.kind === 'phase.finished' && event.phase === 'execute');
  expect(execute!.payload.outputBytes).toBeGreaterThanOrEqual(receipt.liveMetrics.producedBytes);
});
it('does not change the test outcome when advisory native setup fails cleanly', async () => {
  const f = await setup();
  native.metricOffsets = [0, 1000, 2000, 3000];
  const checkpoint = observeCheckpoint();
  const receipt = await f.run({liveMetricMailbox: true, onWindow: () => checkpoint}, {openMailbox: async () => {throw new Error('synthetic private path');}});
  expect(receipt.ok).toBe(true); expect(receipt.result?.outcome).toBe('passed');
  expect(receipt.liveMetrics).toMatchObject({status: 'unavailable', reason: 'setup', quiescence: 'confirmed'});
  expect((await readFile(join(f.outputRoot, K6_HISTORY_CHECKPOINT_NAMES[0]))).byteLength).toBeGreaterThan(0);
});
it('keeps the metric callback moving while a checkpoint sync is held', async () => {
  const f = await setup();
  native.metricOffsets = [0, 1000, 2000, 3000];
  const entered = deferred();
  const release = deferred();
  const { MetricArchive } = await import('../../wrapper/attempt/archive/index.js');
  const sync = vi.spyOn(MetricArchive.prototype, 'syncPrefix').mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
  });
  let timedOut = false;
  const safety = setTimeout(() => { timedOut = true; release.resolve(); }, 2000);
  try {
    const receipt = await f.run({
      liveMetricMailbox: true,
      onWindow: async () => {
        await entered.promise;
        release.resolve();
      },
    }, {openMailbox: async () => new MemoryMailbox()});
    expect(receipt.ok).toBe(true);
    expect(timedOut).toBe(false);
    expect(sync).toHaveBeenCalledOnce();
  } finally {
    clearTimeout(safety);
    release.resolve();
  }
});
it('refuses final publication when advisory descriptor cleanup fails', async () => {
  const f = await setup(); const file = new MemoryMailbox();
  file.close = async () => {throw new Error('synthetic close failure');};
  const receipt = await f.run({liveMetricMailbox: true}, {openMailbox: async () => file});
  expect(receipt.ok).toBe(false); expect(receipt.reason).toBe('cleanup'); expect(receipt.result).toBeNull();
  expect(receipt.liveMetrics.quiescence).toBe('failed'); expect(receipt.quiescence.artifacts).toBe('failed');
});
it('carves initial extent and produced bytes from total and execute ceilings', async () => {
  const f = await setup(); const total = f.offer.budget.outputBytes;
  const ordinary = phaseReservation(reserveOutput(total), f.manifest);
  const enabled = phaseReservation(reserveOutput(total, false, true), f.manifest);
  expect(enabled.live).toBeLessThanOrEqual(Math.floor(total / 8));
  expect(enabled.live).toBeLessThanOrEqual(Math.floor(f.manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes / 8));
  expect(enabled.build + enabled.history + 1048576 + enabled.live + enabled.control + enabled.numeric + enabled.warnings + enabled.diagnostics + enabled.result + enabled.reports).toBeLessThanOrEqual(total);
  expect(enabled.history).toBeLessThan(ordinary.history);
  expect(enabled.history + 1048576 + enabled.live).toBeLessThanOrEqual(f.manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes);
});
it('carries the running target sampler readings in live frames at the approved interval', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({rss: 1234, cpuPercent: 5})));
  const f = await setup(); (f.offer.config as SuiteConfig).targetSampling = {path: '/stats', intervalMs: 1000, timeoutMs: 100, cooldownMs: 0};
  await f.save(); const file = new MemoryMailbox(); native.metricOffsets = [0, 1000, 2000, 3000];
  const receipt = await f.run({liveMetricMailbox: true, onWindow: async () => {await delay(0);}}, {openMailbox: async () => file});
  expect(receipt.ok).toBe(true); expect(receipt.liveMetrics).toMatchObject({status: 'closed', quiescence: 'confirmed'});
  const frame = decodeLiveMetricSnapshot(gunzipSync(captureMailboxImage(file.bytes, hash).frame, {maxOutputLength: 65536}), hash);
  expect(frame.target).toMatchObject({scope: 'target-reported', intervalMs: 1000});
  const targetArchive=frame.archivePrefix!.target!;
  expect(targetArchive).toMatchObject({scope:receipt.scope,intervalMs:1000,samples:1});
  const recorded=await readFile(join(f.outputRoot,targetArchive.data.relativePath));
  expect(hash(recorded.subarray(0,targetArchive.data.bytes))).toBe(targetArchive.data.sha256);
  expect(frame.target!.samples[0]).toMatchObject({phase: 'before', status: 'ready', values: {rss: 1234, cpuPercent: 5, heapAlloc: null}});
  expect(frame.target!.samples.every(sample => sample.observedAtMs <= frame.publishedAtMs)).toBe(true);
});
