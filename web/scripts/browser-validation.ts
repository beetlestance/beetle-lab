import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { standaloneValidators } from '../../contracts/scripts/standalone.js';
import type { Plugin } from 'vite';
import { createApiRegistry } from '../../contracts/src/api/validator-registry.js';
import { createRunnerRegistry } from '../../contracts/src/validator-registry.js';

type Lane = 'api' | 'runner';
const prefix = '\0beetle-static-validator:';
const root = fileURLToPath(new URL('../../contracts/', import.meta.url));
const maximumCodeBytes = 8_388_608;

/** Compile only shipped trusted schemas; generated runtime has no schema compiler. */
export function compileBrowserValidators(lane: Lane, format: 'esm' | 'cjs' = 'esm'): string {
  const registry = lane === 'api' ? createApiRegistry(true) : createRunnerRegistry(true);
  const source = standaloneValidators(registry.ajv, registry.references);
  if (Buffer.byteLength(source) > maximumCodeBytes) throw new Error('Browser validator source limit');
  const result = buildSync({ stdin: { contents: source, sourcefile: 'validators.cjs', resolveDir: root },
    bundle: true, platform: 'browser', target: 'es2023', format, write: false, minify: true });
  const output = result.outputFiles[0]?.text;
  if (!output || Buffer.byteLength(output) > maximumCodeBytes) throw new Error('Browser validator bundle limit');
  return output;
}
function adapter(lane: Lane): string {
  if (lane === 'api') return `import validators from "${prefix}api-code"; export function createApiRegistry(){return {validators};}`;
  return `import all from "${prefix}runner-code"; const primitives={uuid:all.primitive_uuid,cursor:all.primitive_cursor,secretReference:all.primitive_secretReference,artifact:all.primitive_artifact}; const validators={...all}; for(const name of Object.keys(primitives)) delete validators['primitive_'+name]; export function createRunnerRegistry(){return {validators,primitives};}`;
}
export function browserValidation(): Plugin {
  const modules = new Map<string, string>();
  const api = fileURLToPath(new URL('../../contracts/src/api/validate.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../../contracts/src/validate.ts', import.meta.url));
  return { name: 'beetle-static-validation', enforce: 'pre',
    resolveId(source, importer) {
      if (source.startsWith(prefix)) return source;
      if (source !== './validator-registry.js') return null;
      if (importer === api) return prefix+'api';
      if (importer === runner) return prefix+'runner';
      return null;
    },
    load(id) {
      if (id === prefix+'api' || id === prefix+'runner') return adapter(id === prefix+'api' ? 'api' : 'runner');
      if (id !== prefix+'api-code' && id !== prefix+'runner-code') return null;
      if (!modules.has(id)) modules.set(id, compileBrowserValidators(id === prefix+'api-code' ? 'api' : 'runner'));
      return modules.get(id)!;
    },
  };
}
