import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { decodeLiveMetricSnapshot, type LiveMetricSnapshot } from '@beetle/contracts/api';
import type { MetricWindow } from '@beetle/contracts/metrics';
import { createLiveMetricPublisher, type LiveMetricPublisherOptions } from './index.js';
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((pass, fail) => {resolve = pass; reject = fail;});
  return {promise, resolve, reject};
}
export function window(sequence: number): MetricWindow {
  return {startTimeMs: sequence * 1000, endTimeMs: sequence * 1000 + 1000, series: [{metric: 'beetle_requests',
    kind: 'counter', scope: 'execute', tags: {phase: 'execute', request: 'r0'}, total: {kind: 'counter', sum: sequence}}]};
}
export function fixture(overrides: Partial<LiveMetricPublisherOptions> = {}) {
  let now = 0; let wallOffset = 100000;
  const frames: LiveMetricSnapshot[] = [];
  const write = vi.fn(async (bytes: Uint8Array) => {frames.push(decodeLiveMetricSnapshot(bytes, hash));});
  const close = vi.fn(async () => {});
  const options: LiveMetricPublisherOptions = {scope: {organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003', generation: 1},
    producerEpoch: '00000000-0000-4000-8000-000000000004',
    subset: {selected: [{ordinal: 0, metric: 'beetle_requests', kind: 'counter', scope: 'execute', tags: {phase: 'execute', request: 'r0'}}], excludedSeries: 0},
    hash, timeoutMs: 10000, maximumProducedBytes: 1000000, clock: {wall: () => wallOffset + now, monotonic: () => now},
    sink: {write, close}, ...overrides};
  const publisher = createLiveMetricPublisher(options);
  return {publisher, options, frames, write, close, rollback: () => {wallOffset = 0;},
    async advance(ms = 0) {now += ms; await vi.advanceTimersByTimeAsync(ms);}};
}
