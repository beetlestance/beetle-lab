import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
const ignored = new Set(['node_modules', 'dist', '.agent-work']);
export async function sourceFiles(root: string, extension = /\.[cm]?[jt]sx?$/): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(entry => !ignored.has(entry.name)).map(async entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path, extension) : extension.test(entry.name) ? [path] : [];
  }));
  return nested.flat().sort();
}
