import { cp, mkdtemp, readFile, rm, writeFile, unlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { inferenceSchema } from '../scripts/inference.js';
import { runnerSchemas, runnerMessageSchemas } from '../src/index.js';
import { fixture, vectors } from './fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
it('reproduces outputs and detects changed and missing generated files', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'w01-contract-generation-'));
  const run = (check = false) => execFileSync(process.execPath,
    ['--import', 'tsx', join(owned, 'scripts/generate.ts'), ...(check ? ['--check'] : [])],
    { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 65536, timeout: 5000, stdio: 'pipe' });
  try {
    await cp(join(root, 'runner'), join(owned, 'runner'), { recursive: true });
    await cp(join(root, 'scripts'), join(owned, 'scripts'), { recursive: true });
    await writeFile(join(owned, 'package.json'), '{"type":"module"}\n');
    run();
    expect(run(true)).toContain('Checked');
    const generated = join(owned, 'src/generated/types.ts');
    expect(await readFile(generated, 'utf8')).toBe(await readFile(join(root, 'src/generated/types.ts'), 'utf8'));
    await writeFile(generated, '// stale\n');
    expect(() => run(true)).toThrow();
    run();
    await unlink(generated);
    expect(() => run(true)).toThrow();
    run();
    const source = join(owned, 'runner/v1/offer.schema.json');
    await writeFile(source, (await readFile(source, 'utf8')).replace('"title": "Offer"', '"title": "OfferChanged"'));
    expect(() => run(true)).toThrow();
  } finally { await rm(owned, { recursive: true, force: true }); }
});


it('keeps every readable handwritten schema source within 400 physical lines', async () => {
  for (const file of (await readdir(join(root, 'runner/v1'))).filter(name => name.endsWith('.schema.json'))) {
    const source = await readFile(join(root, 'runner/v1', file), 'utf8');
    expect(source.trimEnd().split('\n').length, file).toBeLessThanOrEqual(400);
  }
});

it('preserves conformance semantics in the generated reference-expanded inference projection', async () => {
  const ajv = new Ajv2020({ strict: true });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  const catalogue = new Map(runnerSchemas.map(schema => [schema.$id, schema]));
  const validators = new Map(Object.entries(runnerMessageSchemas).map(([name, schema]) =>
    [name, ajv.compile(inferenceSchema(schema, catalogue) as object)]));
  for (const vector of await vectors()) {
    expect(validators.get(vector.schema)?.(await fixture(vector.path)), vector.path).toBe(vector.valid);
  }
});
