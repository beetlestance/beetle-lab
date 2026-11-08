import { lstat, mkdtemp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { metricLayout } from '../plan/index.js';
import type { CompiledSuite, DeepReadonly } from '../plan/index.js';
import { validateAttempt } from '../runtime/index.js';
import type { AttemptBudget } from '../runtime/index.js';
import { writePlanData } from './serialize.js';

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptCap = 64 * 1_048_576;
const nativeExternals = ['k6', 'k6/http', 'k6/execution', 'k6/metrics'];
async function admitRuntimeSource(): Promise<void> {
  let bytes = 0;
  for (const owner of ['runtime', 'plan']) {
    const directory = join(engineRoot, owner);
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (file.name === 'CONTEXT.md') continue;
      if (!file.isFile() || !file.name.endsWith('.ts')) throw new Error('script_source');
      bytes += (await stat(join(directory, file.name))).size;
      if (bytes > 2 * 1_048_576) throw new Error('script_limit');
    }
  }
}
function entrypoint(suite: DeepReadonly<CompiledSuite>, attempt: AttemptBudget): string {
  const directory = join(engineRoot, 'runtime');
  const imports = [
    `import suite from './plan.json';`,
    `import { createNativeRuntime, nativeIteration, nativeSetup, nativeOptions, summaryProjection } from ${JSON.stringify(join(directory, 'native-entry.ts'))};`,
    `export const attempt = ${JSON.stringify(attempt)};`,
    'export const options = nativeOptions(suite, attempt);',
    'const runtime = createNativeRuntime(suite, attempt);',
    'export function setup() { return nativeSetup(runtime, attempt); }',
    `export function handleSummary(data) { return { 'beetle-evidence.json': summaryProjection(suite, data) }; }`,
  ];
  for (let index = 0; index < suite.loadPlan.execution.scenarios.length; index++) {
    if (suite.loadPlan.execution.scenarios[index]!.entrypoint !== `loadScenario${index}`) throw new Error('script_entrypoint');
    imports.push(`export function loadScenario${index}(data) { nativeIteration(runtime, suite, ${index}, data); }`);
  }
  return imports.join('\n');
}
function approvedInput(path: string, staging: string): boolean {
  const absolute = resolve(path);
  const owner = relative(engineRoot, absolute).replaceAll('\\', '/');
  return absolute === join(staging, 'entry.ts') || absolute === join(staging, 'plan.json')
    || owner.startsWith('runtime/') || owner.startsWith('plan/');
}
function admitBundleBytes(files: readonly { contents: Uint8Array }[], maximumBytes: number): void {
  if (files.length !== 1) throw new Error('script_provenance');
  if (files[0]!.contents.byteLength > Math.min(scriptCap, maximumBytes)) throw new Error('script_limit');
}
async function freshScript(path: string): Promise<void> {
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('script_exists');
}
async function bundle(staging: string, maximumBytes: number): Promise<string> {
  const output = join(staging, 'bundle', 'suite.js');
  const result = await build({ entryPoints: [join(staging, 'entry.ts')], outfile: output,
    format: 'esm', platform: 'neutral', target: 'es2020', bundle: true, splitting: false,
    minify: true, sourcemap: false, write: false, logLevel: 'silent', metafile: true,
    external: nativeExternals, charset: 'utf8',
  });
  admitBundleBytes(result.outputFiles, maximumBytes);
  if (result.outputFiles[0]!.path !== output) throw new Error('script_provenance');
  for (const path of Object.keys(result.metafile.inputs)) if (!approvedInput(path, staging)) throw new Error('script_dependency');
  for (const generated of Object.values(result.metafile.outputs)) {
    for (const imported of generated.imports) if (!nativeExternals.includes(imported.path)) throw new Error('script_dependency');
  }
  await mkdir(dirname(output));
  await writeFile(output, result.outputFiles[0]!.contents, { flag: 'wx', mode: 0o600 });
  return output;
}
/** Emits the one runnable script for later run/export; never accepts secret values. */
export interface BuildInput {
  readonly suite: DeepReadonly<CompiledSuite>;
  readonly outputDirectory: string;
  readonly attempt: AttemptBudget;
  /** Caller-reserved logical file bytes, including simultaneous plan/entry/bundle scratch. */
  readonly maximumBuildBytes?: number;
}
export interface BuildOutput { readonly scriptPath: string; readonly bytes: number; readonly peakBytes: number }
export async function buildRuntimeScript(input: BuildInput): Promise<BuildOutput> {
  const attempt = validateAttempt(input.attempt);
  metricLayout(input.suite);
  const maximum = input.maximumBuildBytes ?? Number.MAX_SAFE_INTEGER;
  const entry = entrypoint(input.suite, attempt);
  const entryBytes = Buffer.byteLength(entry);
  if (!Number.isSafeInteger(maximum) || maximum <= entryBytes) throw new Error('script_limit');
  await admitRuntimeSource();
  await freshScript(join(input.outputDirectory, 'suite.js'));
  await mkdir(input.outputDirectory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(input.outputDirectory, '.native-build-'));
  try {
    const planBytes = await writePlanData(join(staging, 'plan.json'), input.suite, maximum - entryBytes);
    await writeFile(join(staging, 'entry.ts'), entry, { flag: 'wx', mode: 0o600 });
    const output = await bundle(staging, maximum - entryBytes - planBytes);
    const bytes = (await stat(output)).size;
    const scriptPath = join(input.outputDirectory, 'suite.js');
    await rename(output, scriptPath);
    return { scriptPath, bytes, peakBytes: entryBytes + planBytes + bytes };
  } catch { throw new Error('script_build_failed'); }
  finally { await rm(staging, { recursive: true, force: true }); }
}
