import { constants } from 'node:fs';
import { open, writeFile, readFile, unlink, symlink, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { archiveProducer } from '../producer.js';
import type { RecipeFile } from './catalog.js';
import { sourceName } from './catalog.js';
export const sourceBudget = 512 * 1024 ** 2;
export async function sourceHash(
  path: string,
  maximum: number,
  algorithm: 'sha1' | 'sha256' | 'sha512',
  gitBlob = false,
) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum) throw Error('Source file bound');
    const hash = createHash(algorithm);
    if (gitBlob) hash.update(`blob ${info.size}\0`);
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      bytes += chunk.length;
      if (bytes > maximum) throw Error('Source file bound');
      hash.update(chunk);
    }
    if (bytes !== info.size) throw Error('Source file changed');
    return { bytes, digest: hash.digest('hex') };
  } finally {
    await file.close();
  }
}
/** One sequential owner; reserve the active output ceiling from a finite aggregate. */
export class SourceDownloads {
  private remaining = sourceBudget;
  async get(url: string, destination: string, maximum: number): Promise<number> {
    const bound = Math.min(maximum, this.remaining);
    if (bound < 1) throw Error('Source download budget exhausted');
    const bytes = await archiveProducer({
      executable: 'curl',
      args: [
        '--silent',
        '--show-error',
        '--fail',
        '--location',
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '--max-time',
        '115',
        url,
      ],
      destination,
      maximumBytes: bound,
    });
    this.remaining -= bytes;
    return bytes;
  }
  status() {
    return { bytes: sourceBudget - this.remaining };
  }
}
export function sourceLinkTarget(value: string, files: readonly RecipeFile[]): string {
  sourceName(value);
  if (!files.some((file) => file.name === value && file.mode !== '120000'))
    throw Error('Recipe link must select a known regular sibling');
  return value;
}
export async function finishRecipeFile(
  path: string,
  asset: RecipeFile,
  siblings: readonly RecipeFile[],
): Promise<void> {
  const actual = await sourceHash(path, 2 * 1024 ** 2, 'sha1', true);
  if (actual.bytes !== asset.bytes || actual.digest !== asset.gitBlob) throw Error('Pinned recipe Git blob mismatch');
  if (asset.mode === '120000') {
    if (asset.bytes > 180) throw Error('Recipe link bound');
    const target = sourceLinkTarget(await readFile(path, 'utf8'), siblings);
    await unlink(path);
    await symlink(target, path);
  } else await chmod(path, asset.mode === '100755' ? 0o755 : 0o644);
}
export async function emptyRecipe(path: string): Promise<void> {
  await writeFile(path, '', { flag: 'wx', mode: 0o600 });
}
