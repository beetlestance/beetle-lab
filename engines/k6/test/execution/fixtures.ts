import { join } from 'node:path';
import { compiled } from '../suite/fixtures.js';
import { configFor } from '../runtime/fixtures.js';
import { Execution } from '../../wrapper/execution/operation.js';
import { snapshot } from '../../wrapper/execution/profile.js';
import type { ExecutionOptions, MeasurementReceipt } from '../../wrapper/execution/index.js';
import type { ExecutionPorts } from '../../wrapper/execution/ports.js';
import type { NativeProcessOptions, ProcessObservation } from '../../wrapper/process/index.js';
import type { SummaryCollection, SummaryResult } from '../../wrapper/collection/index.js';
import type { MetricWindow } from '../../aggregation/index.js';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const signal = () => new AbortController().signal;
export function observation(overrides: Partial<ProcessObservation> = {}): ProcessObservation {
  return Object.freeze({ spawned: true, exitCode: 0, signal: null, cause: null, metricBytes: 0,
    diagnosticBytes: 0, collection: 'complete', state: 'stopped', stdioClosed: true,
    groupAbsent: true, quiescent: true, ...overrides });
}
export function summary(nativeCollection: 'complete' | 'partial' = 'complete'): SummaryCollection {
  const result: SummaryResult = Object.freeze({ ok: true, evidence: Object.freeze({ version: 2,
    timing: Object.freeze({ testRunDurationMs: 100 }), metrics: Object.freeze({}), rawBytes: 1,
    sha256: '1'.repeat(64), nativeCollection }) });
  const quiet = Promise.resolve();
  return { result: Promise.resolve(result), quiesced: quiet, close: () => quiet };
}
export function encoded(points: readonly { metric: string; value: number; timeMs: number; tags?: Record<string, string> }[]): Uint8Array {
  const declarations = new Set<string>();
  const records: object[] = [];
  for (const point of points) {
    if (!declarations.has(point.metric)) {
      records.push({ type: 'Metric', metric: point.metric, data: { type: 'counter' } });
      declarations.add(point.metric);
    }
    records.push({ type: 'Point', metric: point.metric, data: { value: point.value,
      time: new Date(point.timeMs).toISOString(), tags: point.tags ?? {} } });
  }
  return new TextEncoder().encode(records.map(record => JSON.stringify(record)).join('\n') + '\n');
}
export const measured = () => encoded([
  { metric: 'beetle_measure_started', value: 1, timeMs: 1000 },
  { metric: 'http_reqs', value: 900, timeMs: 900, tags: { phase: 'prepare', request: 'r1' } },
  { metric: 'http_reqs', value: 1, timeMs: 1100, tags: { phase: 'execute', request: 'r0' } },
]);
export function setup() {
  const config = configFor();
  config.requests[0]!.assertions = [{ id: 'ok', kind: 'statusEq', required: true, value: 200 }];
  const state = { wall: 2000, mono: 0, built: 0, created: 0, ran: 0, nativeClosed: 0, collected: 0, summaryClosed: 0 };
  const windows: MetricWindow[] = [];
  const markers: MeasurementReceipt[] = [];
  let nativeOptions: NativeProcessOptions | undefined;
  const options: ExecutionOptions = { compiled: { suite: compiled(config), attempt: { mode: 'managed', timeoutMs: 10_000, deadlineMs: 10_000 } },
    binary: '/owned/k6', emptyConfig: '/owned/empty.json', outputDirectory: '/owned/output', uid: 1000,
    limits: { maximumBuildBytes: 65_536, reservedOutputBytes: 1_114_112, maximumMetricBytes: 1_048_576,
      maximumMetricRecords: 1000, maximumDiagnosticBytes: 1000, drainTimeoutMs: 1000, collectionTimeoutMs: 1000 },
    clock: { wall: () => state.wall, monotonic: () => state.mono },
    window: async value => { windows.push(value); }, measureStarted: async value => { markers.push(value); } };
  const ports: ExecutionPorts = {
    build: async input => { state.built++; return { scriptPath: join(input.outputDirectory, 'suite.js'), bytes: 100, peakBytes: 200 }; },
    native: input => {
      state.created++; nativeOptions = input;
      return { run: async () => {
        state.ran++; const bytes = measured(); await input.sink(bytes, { signal: input.signal ?? signal(), deadlineMs: 10_000 });
        return observation({ metricBytes: bytes.byteLength });
      }, close: async () => { state.nativeClosed++; } };
    },
    summary: input => {
      state.collected++; const operation = summary(input.process.collection);
      return { ...operation, close: async () => { state.summaryClosed++; await operation.close(); } };
    },
  };
  return { options, ports, state, windows, markers, nativeOptions: () => nativeOptions };
}
export function launch(options: ExecutionOptions, ports: ExecutionPorts): Execution {
  return new Execution(snapshot(options), ports);
}
export async function flush(): Promise<void> { for (let index = 0; index < 30; index++) await Promise.resolve(); }
