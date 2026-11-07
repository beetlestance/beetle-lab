import { cp, mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

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
