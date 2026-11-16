import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as builder from '../../build/index.js';
import { exportStandaloneScript, StandaloneExportError } from '../../export/index.js';
import type { StandaloneExportInput } from '../../export/index.js';
import { directories, inspect, suite } from './fixtures.js';

const directory = directories();
const maximumBuildBytes = 1_048_576;
afterEach(() => { vi.restoreAllMocks(); });
it('exports all seven compiled executors, discovery, readiness and embedded data through one unchanged actual build', async () => {
  const root = await directory(); const compiled = suite({ embedded: true, allScenarios: true });
  const spy = vi.spyOn(builder, 'buildRuntimeScript');
  const output = await exportStandaloneScript({ suite: compiled, outputDirectory: join(root, 'export'), timeoutMs: 60_000, maximumBuildBytes });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]![0]).toEqual({ suite: compiled, outputDirectory: join(root, 'export'),
    attempt: { mode: 'standalone', timeoutMs: 60_000 }, maximumBuildBytes });
  const exported = await readFile(output.scriptPath, 'utf8');
  const parity = await builder.buildRuntimeScript({ suite: compiled, outputDirectory: join(root, 'execution-builder'),
    attempt: { mode: 'standalone', timeoutMs: 60_000 }, maximumBuildBytes });
  expect(await readFile(parity.scriptPath, 'utf8')).toBe(exported);
  expect(output.bytes).toBe(parity.bytes); expect(output.peakBytes).toBe(parity.peakBytes);
  expect(Object.keys(output).sort()).toEqual(['bytes', 'peakBytes', 'scriptPath']); expect(Object.isFrozen(output)).toBe(true);
  expect(output.bytes).toBe(Buffer.byteLength(exported)); expect(output.peakBytes).toBeGreaterThan(output.bytes);
  expect((await stat(output.scriptPath)).mode & 0o777).toBe(0o600);
  expect(await readdir(join(root, 'export'))).toEqual(['suite.js']);
  expect(exported).not.toMatch(/node:|ajv|json-schema-to-ts|synthetic-secret-canary/);
  const test = await inspect(exported);
  expect(test.value.attempt).toEqual({ mode: 'standalone', timeoutMs: 60_000 });
  expect(test.value.options.scenarios).toEqual(compiled.loadPlan.options.scenarios);
  expect(Object.values(test.value.options.scenarios).map(item => item.executor)).toEqual(['constant-arrival-rate', 'ramping-arrival-rate',
    'ramping-vus', 'constant-vus', 'shared-iterations', 'per-vu-iterations', 'ramping-arrival-rate']);
  expect(test.value.options.thresholds['http_req_duration{phase:execute}']).toContainEqual({ threshold: 'p(99)<=10', abortOnFail: true });
  expect(test.value.options.setupTimeout).toBe('340ms'); expect(test.value.options.systemTags).toEqual([]);
  const data = test.value.setup(); expect(data).toEqual({ deadlineMs: 61_000 });
  expect(test.requests).toHaveLength(1); expect(test.requests[0]!.url).toContain('/health');
  for (let index = 0; index < 7; index++) test.value[`loadScenario${index}`]!(data);
  expect(test.requests).toHaveLength(8);
  expect(test.requests[1]!.url).toContain('/embedded/alpha?value=pinned-value');
  expect(test.requests[1]!.params.headers['x-csv']).toBe('café');
  expect(test.requests[2]!.body).toBe('text café alpha');
  expect(JSON.parse(test.requests[3]!.body!)).toEqual({ name: 'pinned-value', emoji: '🪲' });
  expect(test.metrics.filter(metric => metric.name === 'beetle_measure_started')).toHaveLength(1);
});
it('captures supplied scalar options and the owned suite before asynchronous builder work', async () => {
  const root = await directory(); const compiled = suite(); const spy = vi.spyOn(builder, 'buildRuntimeScript');
  const options = { suite: compiled, outputDirectory: join(root, 'original'), timeoutMs: 1234, maximumBuildBytes };
  const pending = exportStandaloneScript(options);
  options.outputDirectory = join(root, 'changed'); options.timeoutMs = 1; options.maximumBuildBytes = 1; options.suite = suite({ allScenarios: true });
  const output = await pending; expect(output.scriptPath).toBe(join(root, 'original', 'suite.js'));
  expect(await readdir(root)).toEqual(['original']);
  expect(spy).toHaveBeenCalledTimes(1); const captured = spy.mock.calls[0]![0];
  expect(captured.suite).toBe(compiled); expect(captured.maximumBuildBytes).toBe(maximumBuildBytes);
  expect(Object.isFrozen(captured)).toBe(true); expect(Object.isFrozen(captured.attempt)).toBe(true);
  const test = await inspect(await readFile(output.scriptPath, 'utf8'));
  expect(test.value.attempt).toEqual({ mode: 'standalone', timeoutMs: 1234 }); expect(test.value.setup()).toEqual({ deadlineMs: 2234 });
});
it('refuses even unused declared secret references before the actual builder or any output IO', async () => {
  const root = await directory(); const compiled = suite({ secrets: true }); const spy = vi.spyOn(builder, 'buildRuntimeScript');
  const pending = exportStandaloneScript({ suite: compiled, outputDirectory: join(root, 'secret-reference-canary'), timeoutMs: 1000, maximumBuildBytes });
  await expect(pending).rejects.toMatchObject({ code: 'unsupported_secrets', message: 'Standalone export unsupported_secrets' });
  await expect(pending).rejects.toBeInstanceOf(StandaloneExportError);
  expect(spy).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
});
it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined])('rejects malformed required scratch allowance %s before build IO', async maximum => {
  const root = await directory(); const spy = vi.spyOn(builder, 'buildRuntimeScript');
  const input: unknown = { suite: suite(), outputDirectory: join(root, 'output'), timeoutMs: 1000, maximumBuildBytes: maximum };
  await expect(exportStandaloneScript(input as StandaloneExportInput)).rejects.toMatchObject({ code: 'invalid_input', message: 'Standalone export invalid_input' });
  expect(spy).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
});
it.each([0, -1, 1.5, 172_800_001, NaN, Infinity, undefined])('reuses the runtime timeout rejection for %s before build IO', async timeoutMs => {
  const root = await directory(); const spy = vi.spyOn(builder, 'buildRuntimeScript');
  const input: unknown = { suite: suite(), outputDirectory: join(root, 'output'), timeoutMs, maximumBuildBytes };
  await expect(exportStandaloneScript(input as StandaloneExportInput)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(spy).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
});
it.each(['suite', 'outputDirectory', 'timeoutMs', 'maximumBuildBytes'] as const)('refuses accessor %s options without invoking them', async field => {
  const root = await directory(); const getter = vi.fn(() => { throw new Error('option-canary'); });
  const options = { suite: suite(), outputDirectory: join(root, 'output'), timeoutMs: 1000, maximumBuildBytes };
  Object.defineProperty(options, field, { enumerable: true, get: getter });
  const spy = vi.spyOn(builder, 'buildRuntimeScript');
  await expect(exportStandaloneScript(options)).rejects.toMatchObject({ code: 'invalid_input', message: 'Standalone export invalid_input' });
  expect(getter).not.toHaveBeenCalled(); expect(spy).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
});
it('requires the actual owned frozen compiler result and all required supplied options', async () => {
  const root = await directory(); const compiled = suite(); const spy = vi.spyOn(builder, 'buildRuntimeScript');
  const base = { suite: compiled, outputDirectory: join(root, 'output'), timeoutMs: 1000, maximumBuildBytes };
  for (const input of [null, { ...base, suite: null }, { ...base, suite: structuredClone(compiled) },
    { suite: compiled, outputDirectory: base.outputDirectory, timeoutMs: 1000 }, { ...base, outputDirectory: '' }, { ...base, outputDirectory: 'path\0canary' }]) {
    await expect(exportStandaloneScript(input as StandaloneExportInput)).rejects.toMatchObject({ code: 'invalid_input' });
  }
  expect(spy).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
});
it('accepts the actual scratch peak, rejects one byte less and refuses a final-output-only allowance', async () => {
  const root = await directory(); const compiled = suite({ embedded: true });
  const base = { suite: compiled, timeoutMs: 1000, maximumBuildBytes };
  const baseline = await exportStandaloneScript({ ...base, outputDirectory: join(root, 'baseline') });
  const exact = await exportStandaloneScript({ ...base, outputDirectory: join(root, 'exact'), maximumBuildBytes: baseline.peakBytes });
  expect(exact.bytes).toBe(baseline.bytes); expect(exact.peakBytes).toBe(baseline.peakBytes);
  for (const [name, cap] of [['one-byte-short', baseline.peakBytes - 1], ['output-only', baseline.bytes]] as const) {
    await expect(exportStandaloneScript({ ...base, outputDirectory: join(root, name), maximumBuildBytes: cap }))
      .rejects.toMatchObject({ code: 'build_failed', message: 'Standalone export build_failed' });
    expect(await readdir(join(root, name))).toEqual([]);
  }
  expect(await readFile(exact.scriptPath, 'utf8')).toBe(await readFile(baseline.scriptPath, 'utf8'));
});
it('preserves an existing script and maps its builder refusal to a fixed safe error', async () => {
  const root = await directory(); const outputDirectory = join(root, 'output'); await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(join(outputDirectory, 'suite.js'), 'existing-private-canary', { mode: 0o600 });
  await expect(exportStandaloneScript({ suite: suite(), outputDirectory, timeoutMs: 1000, maximumBuildBytes }))
    .rejects.toMatchObject({ code: 'build_failed', message: 'Standalone export build_failed' });
  expect(await readFile(join(outputDirectory, 'suite.js'), 'utf8')).toBe('existing-private-canary');
  expect(await readdir(outputDirectory)).toEqual(['suite.js']);
});
