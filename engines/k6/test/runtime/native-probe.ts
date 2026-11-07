/** Manual inspect plus two no-network 1VU/1iteration native compatibility probes. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';
import { buildRuntimeScript } from '../../build/index.js';
import { writePlanData } from '../../build/serialize.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from './fixtures.js';

const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Provide the installed absolute native k6 binary');
const directory = await mkdtemp('/private/tmp/w09-native-');
const config = join(directory, 'empty-config.json');
await writeFile(config, '{}\n');
const bounded = { cwd: directory, env: { K6_NO_USAGE_REPORT: 'true' }, encoding: 'utf8' as const,
  timeout: 5000, maxBuffer: 65_536 };
const version = spawnSync(binary, ['version'], bounded);
if (version.error || version.status !== 0) throw new Error('native_version_failed');
const suiteConfig = configFor();
suiteConfig.secrets = []; suiteConfig.requests[0]!.headers = {};
suiteConfig.loadPlan.scenarios = [{ id: 'main', name: 'main', executor: 'per-vu-iterations',
  startTime: '0s', gracefulStop: '0s', vus: 1, iterations: 1, maxDuration: '1s' }];
const suite = compiled(suiteConfig);
const attempt = { mode: 'standalone' as const, timeoutMs: 1000 };
const actual = await buildRuntimeScript({ suite, outputDirectory: join(directory, 'actual'), attempt });
const inspected = spawnSync(binary, ['inspect', '--execution-requirements', '--config', config, actual.scriptPath], bounded);
const records: { name: string; expected: number; exit: number | null; stdout: string; stderr: string; sha256: string }[] = [];
async function record(name: string, expected: number, result: typeof inspected, source: string): Promise<void> {
  records.push({ name, expected, exit: result.status, stdout: result.stdout, stderr: result.stderr,
    sha256: createHash('sha256').update(await readFile(source)).digest('hex') });
  if (result.error || result.status !== expected) process.exitCode = 1;
}
await record('actual-runtime-inspect', 0, inspected, actual.scriptPath);
const fixtureSuite = structuredClone(suite); delete fixtureSuite.readiness;
await writePlanData(join(directory, 'plan.json'), fixtureSuite);
const runtimeDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../runtime');
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'native-fixture.ts');
for (const [name, failed, expected] of [['passing', false, 0], ['required-failure', true, 99]] as const) {
  const entry = join(directory, name + '.ts');
  const source = [
    `import suite from './plan.json';`,
    `import { createNativeUnit } from ${JSON.stringify(fixture)};`,
    `import { nativeOptions, nativeSetup, nativeIteration, summaryProjection } from ${JSON.stringify(join(runtimeDirectory, 'native-entry.ts'))};`,
    'const attempt = {mode:"standalone",timeoutMs:1000};',
    'export const options = nativeOptions(suite,attempt);',
    `const runtime = createNativeUnit(suite, ${failed});`,
    'export function setup() { return nativeSetup(runtime,attempt); }',
    'export function loadScenario0(data) { nativeIteration(runtime,suite,0,data); }',
    'export function handleSummary(data) { return {stdout: summaryProjection(suite,data)}; }',
  ].join('\n');
  await writeFile(entry, source);
  await build({ entry: [entry], outDir: directory, format: ['esm'], platform: 'neutral', target: 'es2020',
    bundle: true, splitting: false, minify: true, dts: false, clean: false, silent: true, config: false,
    external: ['k6', 'k6/http', 'k6/execution', 'k6/metrics'] });
  const script = join(directory, name + '.js');
  const result = spawnSync(binary, ['run', '--no-usage-report', '--quiet', '--no-color', '--address', '', '--config', config, script], bounded);
  await record('no-network-' + name, expected, result, script);
  const summary = JSON.parse(result.stdout) as { metrics: Record<string, { values: Record<string, number> }> };
  if (summary.metrics['beetle_requests{request:r0}']?.values.count !== 1
    || summary.metrics['beetle_assertions{assertion:a0}']?.values.count !== 1
    || summary.metrics.beetle_required_failures?.values.count !== (failed ? 1 : 0)) throw new Error('native_evidence_failed');
}
await writeFile(join(directory, 'evidence.json'), JSON.stringify({ version: version.stdout.trim(),
  usageReporting: false, nativeHttpTargets: [], fixtureVus: 1, fixtureIterations: 1, processTimeoutMs: 5000, records }, null, 2));
console.log(JSON.stringify({ directory, version: version.stdout.trim(), probes: records.map(({ name, expected, exit }) => ({ name, expected, exit })) }));
