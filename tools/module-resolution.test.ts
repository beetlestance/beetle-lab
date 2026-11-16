import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { resolveLocalImport } from './module-resolution.js';

it('resolves extensionless, TSX, JS-to-TS and directory-index edges for cycle detection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beetle-resolution-'));
  try {
    await mkdir(join(root, 'feature'));
    for (const name of ['start.ts', 'screen.tsx', 'feature/index.ts']) await writeFile(join(root, name), 'export {};');
    const local = (name: string) => relative(process.cwd(), join(root, name));
    const known = new Set(['start.ts', 'screen.tsx', 'feature/index.ts'].map(local));
    const importer = join(root, 'main.ts');
    expect(resolveLocalImport(importer, './start', known)).toBe(local('start.ts'));
    expect(resolveLocalImport(importer, './start.js', known)).toBe(local('start.ts'));
    expect(resolveLocalImport(importer, './screen', known)).toBe(local('screen.tsx'));
    expect(resolveLocalImport(importer, './feature', known)).toBe(local('feature/index.ts'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
