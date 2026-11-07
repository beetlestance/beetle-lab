import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { safeRelative } from './validate.js';

/** Run again against changed paths at submission; dispatch cannot constrain future tool calls. */
export async function checkWritePaths(root: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (!safeRelative(path)) throw new Error(`Unsafe write path: ${path}`);
    let parent = root;
    for (const segment of path.split('/')) {
      parent = join(parent, segment);
      try {
        if ((await lstat(parent)).isSymbolicLink()) throw new Error(`Symlink write path: ${path}`);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
        throw error;
      }
    }
  }
}
