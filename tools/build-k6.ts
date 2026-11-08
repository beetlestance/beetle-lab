import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'tsup';

const copies: { source: string; destination: string; files: string[] }[] = [];
for (const owner of ['runtime', 'plan']) {
  const source = join('engines/k6', owner); const destination = join('engines/k6/dist', owner);
  const files: string[] = [];
  for (const file of await readdir(source, { withFileTypes: true })) {
    if (file.name === 'CONTEXT.md') continue;
    if (!file.isFile() || !file.name.endsWith('.ts')) throw new Error('Unexpected runtime source');
    files.push(file.name);
  }
  try {
    for (const existing of await readdir(destination, { withFileTypes: true })) {
      if (!existing.isFile() || !files.includes(existing.name)) throw new Error('Stale runtime build output; use a fresh build directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  copies.push({ source, destination, files });
}

// Keep esbuild external: its runtime selects the installed platform binary.
// The bundled builder resolves runtime/plan relative to dist/bootstrap/main.js.
await build({ entry: { main: 'engines/k6/bootstrap/main.ts' }, outDir: 'engines/k6/dist/bootstrap',
  format: ['esm'], platform: 'node', target: 'node24', bundle: true,
  noExternal: [/^(?!esbuild$).*/], external: ['esbuild'], shims: true,
  removeNodeProtocol: false, splitting: false, clean: false,
  banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" } });
for (const { source, destination, files } of copies) {
  await mkdir(destination, { recursive: true });
  for (const file of files) await copyFile(join(source, file), join(destination, file));
}
