import { mkdtemp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';
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
async function bundle(staging: string): Promise<string> {
  await build({ entry: { suite: join(staging, 'entry.ts') }, outDir: join(staging, 'bundle'),
    format: ['esm'], platform: 'neutral', target: 'es2020', bundle: true, splitting: false,
    minify: true, sourcemap: false, dts: false, clean: false, silent: true, config: false,
    external: nativeExternals, esbuildOptions: options => { options.metafile = true; options.charset = 'utf8'; },
    esbuildPlugins: [{ name: 'native-boundary', setup(context) {
      context.onEnd(result => {
        if (!result.metafile || !result.outputFiles) throw new Error('script_provenance');
        for (const path of Object.keys(result.metafile.inputs)) if (!approvedInput(path, staging)) throw new Error('script_dependency');
        for (const output of Object.values(result.metafile.outputs)) {
          for (const imported of output.imports) if (!nativeExternals.includes(imported.path)) throw new Error('script_dependency');
        }
        for (const output of result.outputFiles) if (output.contents.byteLength > scriptCap) throw new Error('script_limit');
      });
    } }],
  });
  const output = join(staging, 'bundle', 'suite.js');
  if ((await stat(output)).size > scriptCap) throw new Error('script_limit');
  return output;
}
/** Emits the one runnable script for later run/export; never accepts secret values. */
export async function buildRuntimeScript(input: { suite: DeepReadonly<CompiledSuite>; outputDirectory: string; attempt: AttemptBudget }): Promise<{ scriptPath: string; bytes: number }> {
  const attempt = validateAttempt(input.attempt);
  metricLayout(input.suite);
  await admitRuntimeSource();
  await mkdir(input.outputDirectory, { recursive: true });
  const staging = await mkdtemp(join(input.outputDirectory, '.native-build-'));
  try {
    await writePlanData(join(staging, 'plan.json'), input.suite);
    await writeFile(join(staging, 'entry.ts'), entrypoint(input.suite, attempt), { flag: 'wx' });
    const output = await bundle(staging);
    const bytes = (await stat(output)).size;
    const scriptPath = join(input.outputDirectory, 'suite.js');
    await rename(output, scriptPath);
    return { scriptPath, bytes };
  } catch { throw new Error('script_build_failed'); }
  finally { await rm(staging, { recursive: true, force: true }); }
}
