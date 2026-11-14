import { chmod, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture, native, resetNative } from './fixtures.js';
import { syntheticInstalledIdentity } from '../staged-input/fixtures.js';
import { reserveOutput } from '../../wrapper/attempt/reservation.js';
import { imageOptions } from '../../bootstrap/profile.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';

const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => { await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() { const value = await fixture(); cleanups.push(value.cleanup); return value; }
it.each(['scope', 'hash', 'uid'])('rejects untrusted %s headers before journal/target', async kind => {
  const f = await setup();
  if (kind === 'hash') { f.staging.offerSha256 = '0'.repeat(64); await f.save(false); }
  const result = await f.run(kind === 'scope' ? { expected: { generation: 8 } } : kind === 'uid' ? { uid: f.options.uid + 1 } : {});
  expect(result.ok).toBe(false); expect(result.scope).toBeNull(); expect(native.calls).toBe(0);
  await expect(readFile(join(f.outputRoot, 'control.ndjson'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['input', 'config'])('retains validate journal and no result for %s compilation failure', async kind => {
  const f = await setup();
  if (kind === 'input') await writeFile(join(f.options.inputRoot, 'input-000.bin'), '[{"name":"tampered"}]');
  else { (f.offer.config as SuiteConfig).target = 'bad-url'; await f.save(); }
  const result = await f.run();
  expect(result.reason).toBe('compile'); expect(result.inputFailure?.ok).toBe(false); expect(result.result).toBeNull();
  expect(result.quiescence.input).toBe('confirmed'); expect(native.calls).toBe(0);
  expect(await readFile(join(f.outputRoot, 'control.ndjson'), 'utf8')).toContain('phase.started');
});
it('rejects insufficient output partition before journal or execution', async () => {
  const f = await setup(); f.offer.budget.outputBytes = 1_048_576; await f.save();
  const result = await f.run(); expect(result.reason).toBe('output_limit'); expect(native.calls).toBe(0);
});
it('caps build admission by prepare allowance before native start', async () => {
  const f = await setup(); f.manifest.phases.find(phase => phase.phase === 'prepare')!.outputBytes = 28;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest); await f.save();
  const result = await f.run(); expect(result.execution).toMatchObject({ ok: false, code: 'build' }); expect(result.result).toBeNull();
  expect(native.built?.maximumBuildBytes).toBe(28); expect(native.calls).toBe(0);
});
it.each([100, 99])('enforces exact prepare peak allowance %s before native start', async allowance => {
  const f = await setup(); f.manifest.phases.find(phase => phase.phase === 'prepare')!.outputBytes = allowance;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest); await f.save();
  const result = await f.run(); expect(native.built?.maximumBuildBytes).toBe(allowance);
  expect(native.calls).toBe(allowance === 100 ? 1 : 0); expect(result.ok).toBe(allowance === 100);
});
it('rejects collect allowance below fixed producer ceiling before calling execution', async () => {
  const f = await setup(); f.manifest.phases.find(phase => phase.phase === 'collect')!.outputBytes = 1_048_575;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest); await f.save();
  const result = await f.run(); expect(result.reason).toBe('output_limit'); expect(result.result).toBeNull();
  expect(native.built).toBeUndefined(); expect(native.calls).toBe(0);
});
it.each([0, 1])('reserves collect final-drain room before native load (%s byte short)', async short => {
  const f = await setup();
  const minimum = 2 * 1_048_576 + 524_288 + 65_536;
  f.manifest.phases.find(phase => phase.phase === 'collect')!.outputBytes = minimum - short;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest); await f.save();
  const result = await f.run();
  if (short) {
    expect(result.reason).toBe('output_limit'); expect(result.result).toBeNull(); expect(native.calls).toBe(0);
    await expect(readFile(join(f.outputRoot, 'numeric-final.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } else {
    expect(result.ok, JSON.stringify(result)).toBe(true); expect(native.calls).toBe(1);
    expect(result.result!.artifacts.map(artifact => artifact.kind)).toEqual(['metric-windows', 'metric-index', 'native-summary', 'numeric-final', 'performance-report', 'metrics-csv']);
    expect(result.result!.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0)).toBeLessThanOrEqual(minimum);
  }
});
it('bounds result publication by the manifest seal output allowance before writing', async () => {
  const f = await setup(); f.manifest.phases.find(phase => phase.phase === 'seal')!.outputBytes = 1;
  f.offer.installedIdentity = syntheticInstalledIdentity(f.manifest); await f.save();
  const result = await f.run(); expect(result.reason).toBe('publication'); expect(result.publication).toMatchObject({ ok: false, code: 'limit' });
  expect(result.result).toBeNull(); await expect(readFile(join(f.outputRoot, 'engine-result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('reserves exact finite output partitions without integer overflow', () => {
  const minimum = 3_044_252;
  expect(() => reserveOutput(minimum - 1)).toThrow('output_limit');
  const exact = reserveOutput(minimum); expect(Object.values(exact).every(Number.isSafeInteger)).toBe(true);
  expect(exact.control + exact.numeric + exact.warnings + exact.diagnostics + exact.result + exact.execution + exact.reports).toBe(minimum);
  for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) expect(() => reserveOutput(value)).toThrow('output_limit');
  expect(reserveOutput(Number.MAX_SAFE_INTEGER).build).toBe(89 * 1_048_576);
});
it.each(['result', 'journal', 'root'])('rejects existing %s custody before second invocation', async kind => {
  const f = await setup();
  if (kind === 'root') await chmod(f.outputRoot, 0o755);
  else await writeFile(join(f.outputRoot, kind === 'result' ? 'engine-result.json' : 'control.ndjson'), '{}', { mode: 0o600 });
  const result = await f.run(); expect(result.ok).toBe(false); expect(native.calls).toBe(0);
  if (kind === 'journal') expect(result.quiescence.journal).toBe('unknown');
});
it('refuses a substituted numeric artifact and preserves it without declaring a result', async () => {
  const f = await setup(); await symlink(join(f.options.secretRoot, '_TOKEN'), join(f.outputRoot, 'numeric-final.json'));
  const result = await f.run(); expect(native.calls).toBe(1); expect(result.ok).toBe(false); expect(result.result).toBeNull();
  expect(JSON.stringify(result)).not.toContain('SECRET');
});
it('image profile contains only fixed mounted paths and installed pins', () => {
  const options = imageOptions(new AbortController().signal);
  expect([options.inputRoot, options.secretRoot, options.outputRoot]).toEqual(['/beetle/input', '/beetle/secrets', '/beetle/output']);
  expect(options.installed.version).toBe('2.4.0'); expect(options.installed.configVersion).toBe(1);
});
