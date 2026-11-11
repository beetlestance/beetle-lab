import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { BuildInput } from '../../build/index.js';
import type { NativeProcessOptions } from '../../wrapper/process/index.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';
import { metricEvidenceLayout } from '../../plan/index.js';
import { summaryProjection } from '../../runtime/summary.js';
import { fixture as stagedFixture, now, syntheticInstalledIdentity } from '../staged-input/fixtures.js';
import { runCompiledK6 } from '../../wrapper/execution/index.js';
import { runAttempt } from '../../wrapper/attempt/attempt.js';
import type { StagedK6Options } from '../../wrapper/attempt/index.js';

const native = vi.hoisted(() => ({ calls: 0, closes: 0, failed: false, discovery: false, missingMarker: false,
  closeFails: false, buildFails: false, summaryTamper: false, built: undefined as BuildInput | undefined,
  summaryPadding: 0,
  metricOffsets: undefined as readonly number[] | undefined, wallOffset: 0,
  blockBuild: undefined as Promise<void> | undefined, blockClose: undefined as Promise<void> | undefined }));
export { native };
vi.mock('../../build/index.js', () => ({ buildRuntimeScript: async (input: BuildInput) => {
  native.built = input; await native.blockBuild;
  if (native.buildFails) throw new Error('SECRET_OS_ERROR');
  await writeFile(join(input.outputDirectory, 'suite.js'), '// synthetic native boundary\n', { flag: 'wx', mode: 0o600 });
  return { scriptPath: join(input.outputDirectory, 'suite.js'), bytes: 29, peakBytes: 100 };
} }));
vi.mock('../../wrapper/process/index.js', () => ({ createNativeProcess: (input: NativeProcessOptions) => ({
  run: async () => {
    native.calls++;
    const bytes = stream();
    if (bytes.length) await deliverMetrics(input, bytes);
    const raw = projected(native.built!);
    await writeFile(join(input.directory, 'beetle-evidence.json'), (native.summaryTamper ? raw + ' ' : raw)
      + ' '.repeat(native.summaryPadding), { mode: 0o600, flag: 'wx' });
    return { spawned: true, exitCode: native.failed || native.discovery ? 99 : 0, signal: null, cause: null,
      metricBytes: bytes.length, diagnosticBytes: 0, collection: 'complete', state: 'stopped',
      stdioClosed: true, groupAbsent: true, quiescent: true };
  }, close: async () => { native.closes++; await native.blockClose; if (native.closeFails) throw new Error('SECRET_CLOSE_ERROR'); },
}) }));
async function deliverMetrics(input: NativeProcessOptions, bytes: Uint8Array): Promise<void> {
  const budget = { signal: input.signal!, deadlineMs: input.attempt.mode === 'managed' ? input.attempt.deadlineMs : now + 1000 };
  if (!native.metricOffsets) { await input.sink(bytes, budget); return; }
  const offsets = [...native.metricOffsets];
  for (const [index, line] of Buffer.from(bytes).toString('utf8').trimEnd().split('\n').entries()) {
    if (index >= 3) native.wallOffset = offsets[index - 3]!;
    await input.sink(Buffer.from(line + '\n'), budget);
  }
}
function stream(): Uint8Array {
  if (native.missingMarker) return new Uint8Array();
  return Buffer.from([
    { type: 'Metric', metric: 'beetle_measure_started', data: { type: 'counter' } },
    { type: 'Point', metric: 'beetle_measure_started', data: { value: 1, time: new Date(now).toISOString(), tags: {} } },
    { type: 'Metric', metric: 'http_req_duration', data: { type: 'trend' } },
    ...(native.metricOffsets ?? [0]).map(offset => ({ type: 'Point', metric: 'http_req_duration',
      data: { value: 3, time: new Date(now + offset).toISOString(), tags: { phase: 'execute', request: 'r0' } } })),
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
}
function projected(input: BuildInput): string {
  const metrics = Object.fromEntries(metricEvidenceLayout(input.suite).metrics.map(metric => {
    const failed = native.failed && /beetle_(required_failures|assertion_failures)/.test(metric.key);
    const count = metric.key === 'beetle_measure_started' ? Number(!native.missingMarker)
      : /beetle_(requests|assertions)\{/.test(metric.key) ? 1 : Number(failed);
    const values = metric.kind === 'counter' ? { count, rate: count }
      : metric.kind === 'trend' ? { count: 1, min: 1, max: 1, avg: 1, 'p(95)': 1 }
        : metric.kind === 'rate' ? { rate: 0, passes: 0, fails: 1 } : { value: 1, min: 1, max: 1 };
    return [metric.nativeKey, { values, thresholds: Object.fromEntries(metric.thresholds.map(rule => [rule.threshold,
      { ok: !failed && !(native.discovery && rule.abortOnFail) }])) }];
  }));
  return summaryProjection(input.suite, { state: { testRunDurationMs: Math.max(1000, native.wallOffset) }, metrics });
}
export function resetNative(): void {
  Object.assign(native, { calls: 0, closes: 0, failed: false, discovery: false, missingMarker: false, closeFails: false,
    buildFails: false, summaryTamper: false, summaryPadding: 0, metricOffsets: undefined, wallOffset: 0,
    built: undefined, blockBuild: undefined, blockClose: undefined });
}
export async function fixture() {
  const base = await stagedFixture();
  base.offer.budget.outputBytes = 8_388_608;
  base.manifest.defaultBudget.outputBytes = 8_388_608;
  base.manifest.minimumBudget.outputBytes = 1;
  for (const phase of base.manifest.phases) { phase.timeoutMs = 5000; phase.outputBytes = 4_194_304; }
  const config = base.offer.config as SuiteConfig;
  config.requests[0]!.assertions = [{ id: 'required', kind: 'statusEq', value: 200, required: true }];
  base.offer.installedIdentity = syntheticInstalledIdentity(base.manifest);
  await base.save();
  const outputRoot = join(base.root, 'output'); await mkdir(outputRoot, { mode: 0o700 });
  const options: StagedK6Options = { inputRoot: base.options.inputRoot, secretRoot: base.options.secretRoot,
    outputRoot, uid: base.options.uid, installed: base.options.installed, signal: base.controller.signal };
  const clock = { wall: () => now + native.wallOffset, monotonic: () => performance.now() };
  const protect = async () => {
    for (const root of [options.inputRoot, options.secretRoot]) {
      for (const name of await readdir(root)) await chmod(join(root, name), 0o400);
      await chmod(root, 0o500);
    }
  };
  const cleanup = async () => {
    await Promise.all([chmod(options.inputRoot, 0o700), chmod(options.secretRoot, 0o700)]); await base.cleanup();
  };
  return { ...base, cleanup, outputRoot, options, clock,
    run: async (overrides: Partial<StagedK6Options> = {}) => {
      await protect(); return runAttempt({ ...options, ...overrides }, { execute: runCompiledK6, clock });
    } };
}
export async function flush(): Promise<void> { for (let i = 0; i < 50; i++) await Promise.resolve(); }
