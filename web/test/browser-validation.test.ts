import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { ValidateFunction } from 'ajv';
import { compileBrowserValidators } from '../scripts/browser-validation.js';
import { validateApi } from '@beetle/contracts/api';

it('runs shipped browser validators without string code generation', async () => {
  const source = compileBrowserValidators('api', 'cjs');
  const module = {exports: {} as Record<string, ValidateFunction>};
  runInNewContext(source, {module,exports:module.exports}, {timeout:3000,contextCodeGeneration:{strings:false,wasm:false}});
  const input = JSON.parse(await readFile('contracts/fixtures/api/valid/browser-session.json','utf8')) as unknown;
  expect(module.exports.BrowserSession!(input)).toBe(validateApi('BrowserSession', input).ok);
});

it.each(['api', 'runner'] as const)('preserves shipped positive/negative vectors without eval: %s', async lane => {
  const source = compileBrowserValidators(lane, 'cjs');
  const module = {exports: {} as Record<string, ValidateFunction>};
  runInNewContext(source, {module,exports:module.exports}, {timeout:3000,contextCodeGeneration:{strings:false,wasm:false}});
  const directory = lane === 'api' ? 'contracts/fixtures/api/' : 'contracts/fixtures/';
  const file = directory + (lane === 'api' ? 'vectors.json' : 'manifest.json');
  const vectors = JSON.parse(await readFile(file,'utf8')) as {path:string;schema:string;valid:boolean}[];
  expect(vectors.length).toBeLessThanOrEqual(512);
  for (const vector of vectors) {
    const input = JSON.parse(await readFile(directory+vector.path,'utf8')) as unknown;
    const before = JSON.stringify(input); const validator = module.exports[vector.schema];
    expect(validator,vector.path).toBeTypeOf('function');
    if (!validator) throw new Error('Missing compiled validator');
    expect(validator(input),vector.path).toBe(vector.valid); expect(JSON.stringify(input)).toBe(before);
  }
});
