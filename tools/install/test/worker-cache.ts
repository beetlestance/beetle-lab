import { createHash } from 'node:crypto';
import { lstat, mkdir, open, opendir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';

const maximumFiles = 4096; const maximumFileBytes = 4_194_304; const maximumSourceBytes = 67_108_864;
const configuration = ['package-lock.json', 'package.json', 'agent/package.json', 'contracts/package.json',
  'tsconfig.base.json', 'tsconfig.node.json', 'tools/install/test/worker-cache.ts'];
interface SourceIdentity { fingerprint: string; files: number; bytes: number }
interface CacheIdentity extends SourceIdentity { version: 1; bundleSha256: string }
async function sourcePaths(): Promise<string[]> {
  const paths = [...configuration]; const pending = ['agent/src', 'contracts/src']; let entries = paths.length;
  while (pending.length) {
    const root = pending.pop()!; const directory = await opendir(root);
    for await (const entry of directory) {
      if (++entries > maximumFiles) throw new Error('Journal cache source inventory exceeds bound');
      const path = join(root, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error('Journal cache source must be regular');
    }
  }
  return paths.sort();
}
async function fileIdentity(path: string): Promise<{ sha256: string; bytes: number }> {
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximumFileBytes) throw new Error('Journal cache source exceeds file bound');
    const hash = createHash('sha256'); const buffer = new Uint8Array(65_536); let bytes = 0;
    for (let count = 0; count <= maximumFileBytes / buffer.length; count++) {
      const read = await handle.read(buffer, 0, buffer.length, bytes); bytes += read.bytesRead;
      if (bytes > maximumFileBytes) throw new Error('Journal cache source exceeds file bound');
      if (!read.bytesRead) {
        const after = await handle.stat();
        if (after.size !== bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Journal cache source changed');
        return { sha256: hash.digest('hex'), bytes };
      }
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    throw new Error('Journal cache source read limit');
  } finally { await handle.close(); }
}
export async function sourceIdentity(): Promise<SourceIdentity> {
  const hash = createHash('sha256').update(`w312-journal-cache-v1\0${process.version}\0`);
  const paths = await sourcePaths(); let bytes = 0;
  for (const path of paths) {
    const file = await fileIdentity(path); bytes += file.bytes;
    if (bytes > maximumSourceBytes) throw new Error('Journal cache source exceeds total bound');
    hash.update(JSON.stringify([path, file.sha256, file.bytes]) + '\n');
  }
  return { fingerprint: hash.digest('hex'), files: paths.length, bytes };
}
/** Missing metadata and either changed source or changed bundle always invalidate reuse. */
export function cacheMatches(value: unknown, source: SourceIdentity, bundleSha256: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<CacheIdentity>;
  return identity.version === 1 && identity.fingerprint === source.fingerprint && identity.files === source.files
    && identity.bytes === source.bytes && identity.bundleSha256 === bundleSha256;
}
async function existingIdentity(cache: string): Promise<unknown> {
  try {
    const path = join(cache, 'source-identity.json');
    if ((await stat(path)).size > 4096) throw new Error('Journal cache metadata exceeds bound');
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}
async function boundCache(cache: string): Promise<void> {
  const directory = await opendir(cache); let entries = 0; let bytes = 0;
  for await (const entry of directory) {
    if (++entries > 4 || !['worker.js', 'bundle.sha256', 'source-identity.json'].includes(entry.name) || !entry.isFile()) throw new Error('Unexpected Journal cache file');
    bytes += (await stat(join(cache, entry.name))).size;
    if (bytes > 16_777_216) throw new Error('Task-owned worker cache exceeds bound');
  }
}
export async function journalWorker(): Promise<URL> {
  const cache = join(await realpath(tmpdir()), 'w312-fresh-installation-journal-cache');
  await mkdir(cache, { mode: 0o700, recursive: true });
  const info = await lstat(cache);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 || await realpath(cache) !== cache) {
    throw new Error('Unsafe task-owned Journal cache');
  }
  await boundCache(cache);
  const source = await sourceIdentity(); const bundle = join(cache, 'worker.js');
  const metadata = await existingIdentity(cache); let bundleSha256 = '';
  try { bundleSha256 = (await fileIdentity(bundle)).sha256; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!cacheMatches(metadata, source, bundleSha256)) {
    await build({ config: false, entry: ['agent/src/journal/worker.ts'], outDir: cache, format: ['esm'], platform: 'node',
      target: 'node24', bundle: true, noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, silent: true });
    const after = await sourceIdentity();
    if (after.fingerprint !== source.fingerprint) throw new Error('Journal build source changed');
    bundleSha256 = (await fileIdentity(bundle)).sha256;
    const identity: CacheIdentity = { version: 1, ...source, bundleSha256 };
    await writeFile(join(cache, 'source-identity.json'), JSON.stringify(identity), { mode: 0o600 });
    await writeFile(join(cache, 'bundle.sha256'), bundleSha256, { mode: 0o600 });
  }
  await boundCache(cache); return pathToFileURL(bundle);
}
