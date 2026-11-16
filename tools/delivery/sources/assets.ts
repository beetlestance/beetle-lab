import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceHash, finishRecipeFile, emptyRecipe} from './fetch.js';
import type {SourceDownloads} from './fetch.js';
import type {AlpineSource, UpstreamSource} from './catalog.js';
import type {NpmSource} from './npm.js';
async function matches(path: string, expected: string, algorithm: 'sha256' | 'sha512', maximum: number): Promise<void> {
  if ((await sourceHash(path, maximum, algorithm)).digest !== expected) throw Error('Pinned source digest mismatch');
}
export async function collectAlpine(source: AlpineSource, directory: string, downloads: SourceDownloads): Promise<void> {
  await mkdir(directory, {mode: 0o700});
  for (const file of source.recipeFiles) {
    const path = join(directory, file.name);
    const url = `https://raw.githubusercontent.com/alpinelinux/aports/${source.aportsCommit}/main/${source.origin}/${file.name}`;
    if (file.bytes === 0) await emptyRecipe(path); else await downloads.get(url, path, file.bytes);
    await finishRecipeFile(path, file, source.recipeFiles);
  }
  // Preserve original URLs and the pinned mirror choice; both require the recipe checksum.
  for (const file of source.remote) {
    const path = join(directory, file.name);
    await downloads.get(file.downloadUrl, path, 200 * 1024 ** 2);
    await matches(path, file.sha512, 'sha512', 200 * 1024 ** 2);
  }
  for (const [name, hash] of Object.entries(source.sourceChecksums)) await matches(join(directory, name), hash, 'sha512', 200 * 1024 ** 2);
  // Retain and check the recipe itself; no downloaded shell is ever evaluated.
  if (!(await readFile(join(directory, 'APKBUILD'), 'utf8')).includes(`pkgver=${source.version}`)) throw Error('Recipe version mismatch');
}
export async function collectUpstream(source: UpstreamSource, directory: string, downloads: SourceDownloads): Promise<void> {
  const path = join(directory, source.file); const bytes = await downloads.get(source.url, path, source.bytes);
  if (bytes !== source.bytes) throw Error('Pinned upstream source size mismatch');
  await matches(path, source.sha256, 'sha256', source.bytes);
}
export async function collectNpm(source: NpmSource, directory: string, downloads: SourceDownloads): Promise<void> {
  const path = join(directory, source.file); await downloads.get(source.url, path, 20 * 1024 ** 2);
  await matches(path, source.sha512, 'sha512', 20 * 1024 ** 2);
}
