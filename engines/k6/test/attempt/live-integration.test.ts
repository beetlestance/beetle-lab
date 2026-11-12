import { afterEach, beforeEach, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureMailboxImage, MAILBOX_BYTES } from '@beetle/contracts/live-mailbox';
import { decodeLiveMetricSnapshot } from '@beetle/contracts/api';
import { fixture, native, resetNative } from './fixtures.js';
import { MemoryMailbox } from './live-fixtures.js';
import { reserveOutput, phaseReservation } from '../../wrapper/attempt/reservation.js';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => {await Promise.all(cleanups.splice(0).map(clean => clean()));});
async function setup() {const value = await fixture(); cleanups.push(value.cleanup); return value;}
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
it('publishes during actual measured window callbacks and drains before sealed history', async () => {
  const f = await setup(); const file = new MemoryMailbox(); native.metricOffsets = [0, 1000, 2000, 3000];
  const receipt = await f.run({liveMetricMailbox: true, onWindow: async () => {await delay(0);}}, {openMailbox: async () => file});
  expect(receipt.ok).toBe(true); expect(file.produced).toBeGreaterThan(0); expect(file.closes).toBe(1);
  expect(receipt.liveMetrics).toMatchObject({status: 'closed', quiescence: 'confirmed', producedBytes: MAILBOX_BYTES + file.produced});
  const frame = decodeLiveMetricSnapshot(captureMailboxImage(file.bytes, hash).frame, hash);
  expect(frame.scope).toEqual(receipt.scope); expect(frame.series.some(row => row.metric === 'http_req_duration')).toBe(true);
  const events = (await readFile(join(f.outputRoot, 'control.ndjson'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as {kind: string; phase: string; payload: {outputBytes: number}});
  const execute = events.find(event => event.kind === 'phase.finished' && event.phase === 'execute');
  expect(execute!.payload.outputBytes).toBeGreaterThanOrEqual(receipt.liveMetrics.producedBytes);
});
it('does not change the test outcome when advisory native setup fails cleanly', async () => {
  const f = await setup();
  const receipt = await f.run({liveMetricMailbox: true}, {openMailbox: async () => {throw new Error('synthetic private path');}});
  expect(receipt.ok).toBe(true); expect(receipt.result?.outcome).toBe('passed');
  expect(receipt.liveMetrics).toMatchObject({status: 'unavailable', reason: 'setup', quiescence: 'confirmed'});
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
  expect(enabled.build + enabled.history + 1048576 + enabled.live + enabled.control + enabled.numeric + enabled.result + enabled.reports).toBeLessThanOrEqual(total);
  expect(enabled.history).toBeLessThan(ordinary.history);
  expect(enabled.history + 1048576 + enabled.live).toBeLessThanOrEqual(f.manifest.phases.find(phase => phase.phase === 'execute')!.outputBytes);
});
