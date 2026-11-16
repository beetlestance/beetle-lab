import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { expect, it } from 'vitest';
import { inferenceSchema } from '@beetle/contracts/tooling/inference';
import { apiMessageSchemas, apiOperations, apiSchemas } from '../../src/api/index.js';
import { fixture, vectors } from './fixtures.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

it('reproduces exact outputs and rejects stale, missing, unexpected and changed-source outputs', async () => {
  const owned = await mkdtemp(join(root, 'test/api/.generation-'));
  const run = (check = false) => execFileSync(process.execPath,
    ['--import', 'tsx', join(owned, 'scripts/generate-api.ts'), ...(check ? ['--check'] : [])],
    { cwd: join(root, '..'), encoding: 'utf8', maxBuffer: 65536, timeout: 5000, stdio: 'pipe' });
  try {
    await cp(join(root, 'api/v2'), join(owned, 'api/v2'), { recursive: true });
    await mkdir(join(owned, 'scripts'), { recursive: true });
    await cp(join(root, 'scripts/generate-api.ts'), join(owned, 'scripts/generate-api.ts'));
    await mkdir(join(owned, 'runner/v1'), { recursive: true });
    await cp(join(root, 'runner/v1'), join(owned, 'runner/v1'), { recursive: true });
    await writeFile(join(owned, 'package.json'), '{"type":"module"}\n');
    expect(() => run(true)).toThrow();
    run();
    expect(run(true)).toContain('Checked');
    for (const file of await readdir(join(root, 'src/api/generated'))) {
      expect(await readFile(join(owned, 'src/api/generated', file), 'utf8'))
        .toBe(await readFile(join(root, 'src/api/generated', file), 'utf8'));
    }
    const generated = join(owned, 'src/api/generated/types.ts');
    await writeFile(generated, '// stale\n');
    expect(() => run(true)).toThrow();
    run();
    await unlink(generated);
    expect(() => run(true)).toThrow();
    run();
    const unexpected = join(owned, 'src/api/generated/unexpected.ts');
    await writeFile(unexpected, '// unexpected\n');
    expect(() => run(true)).toThrow();
    await unlink(unexpected);
    const source = join(owned, 'api/v2/common.schema.json');
    await writeFile(source, (await readFile(source, 'utf8')).replace('"title": "ApiCommon"', '"title": "ApiCommonChanged"'));
    expect(() => run(true)).toThrow();
  } finally { await rm(owned, { recursive: true, force: true }); }
});

it('preserves fixture semantics in reference-expanded inference projections', async () => {
  const ajv = new Ajv2020({ strict: true });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  const catalogue = new Map(apiSchemas.map(schema => [schema.$id, schema]));
  const validators = new Map(Object.entries(apiMessageSchemas).map(([name, schema]) =>
    [name, ajv.compile(inferenceSchema(schema, catalogue) as object)]));
  for (const vector of await vectors()) {
    expect(validators.get(vector.schema)?.(await fixture(vector.path)), vector.path).toBe(vector.valid);
  }
});

it('keeps handwritten schema modules within 400 physical lines and binds every route fixture', async () => {
  const covered = new Set((await vectors()).filter(vector => vector.valid).map(vector => vector.schema));
  for (const file of (await readdir(join(root, 'api/v2'))).filter(name => name.endsWith('.schema.json'))) {
    expect((await readFile(join(root, 'api/v2', file), 'utf8')).trimEnd().split('\n').length, file).toBeLessThanOrEqual(400);
  }
  for (const operation of apiOperations) {
    expect(covered.has(operation.response), operation.response).toBe(true);
    if ('request' in operation) expect(covered.has(operation.request), operation.request).toBe(true);
    if ('params' in operation) expect(covered.has(operation.params), operation.params).toBe(true);
    if ('query' in operation) expect(covered.has(operation.query), operation.query).toBe(true);
  }
});
