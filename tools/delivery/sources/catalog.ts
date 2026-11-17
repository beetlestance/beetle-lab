export interface RecipeFile {
  name: string;
  gitBlob: string;
  bytes: number;
  mode: '100644' | '100755' | '120000';
}
export interface RemoteSource {
  name: string;
  url: string;
  downloadUrl: string;
  sha512: string;
}
export interface AlpineSource {
  origin: string;
  version: string;
  packageVersion: string;
  aportsCommit: string;
  recipeTree: string;
  recipeFiles: RecipeFile[];
  remote: RemoteSource[];
  sourceChecksums: Record<string, string>;
}
export interface UpstreamSource {
  name: string;
  version: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}
export interface K6Source {
  version: string;
  revision: string;
  observedArm64BinarySha256: string;
  baseImage: string;
}
export interface SourceCatalog {
  format: 'beetle-third-party-sources';
  version: 1;
  alpine: AlpineSource[];
  upstream: UpstreamSource[];
  k6Binary: K6Source;
}
export function sourceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Source metadata object required');
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || value.length > 2048 || !pattern.test(value))
    throw Error('Source metadata string invalid');
  return value;
}
export function sourceName(value: unknown): string {
  const name = text(value, /^[A-Za-z0-9_+.@-]{1,180}$/);
  if (name === '.' || name === '..') throw Error('Invalid source leaf');
  return name;
}
function bounded(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw Error('Source size bound');
  return value;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error('Source list bound');
  return value;
}
export function sourceUrl(value: unknown): string {
  const url = new URL(text(value, /^https:\/\//));
  if (url.username || url.password || url.port || url.hash) throw Error('Source HTTPS URL required');
  return url.href;
}
function recipeFile(value: unknown): RecipeFile {
  const row = sourceRecord(value);
  const mode = row.mode;
  if (mode !== '100644' && mode !== '100755' && mode !== '120000') throw Error('Unexpected recipe file mode');
  return {
    name: sourceName(row.name),
    gitBlob: text(row.gitBlob, /^[a-f0-9]{40}$/),
    bytes: bounded(row.bytes, 2 * 1024 ** 2),
    mode,
  };
}
export function recipeTreeIdentity(files: readonly RecipeFile[]): string {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  const body = Buffer.concat(
    sorted.flatMap((file) => [Buffer.from(`${file.mode} ${file.name}\0`), Buffer.from(file.gitBlob, 'hex')]),
  );
  return createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
}
function alpine(value: unknown): AlpineSource {
  const row = sourceRecord(value);
  const checks = sourceRecord(row.sourceChecksums);
  const sourceChecksums = Object.fromEntries(
    Object.entries(checks).map(([name, hash]) => [sourceName(name), text(hash, /^[a-f0-9]{128}$/)]),
  );
  const recipeFiles = list(row.recipeFiles, 256).map(recipeFile);
  const remote = list(row.remote, 8).map((item) => {
    const file = sourceRecord(item);
    return {
      name: sourceName(file.name),
      url: sourceUrl(file.url),
      downloadUrl: sourceUrl(file.downloadUrl),
      sha512: text(file.sha512, /^[a-f0-9]{128}$/),
    };
  });
  const names = [...recipeFiles, ...remote].map((file) => file.name);
  if (names.length > 264 || new Set(names).size !== names.length || Object.keys(checks).length > 256)
    throw Error('Duplicate or excessive source leaves');
  if (
    !recipeFiles.some((file) => file.name === 'APKBUILD') ||
    Object.keys(checks).some((name) => !names.includes(name))
  )
    throw Error('Incomplete recipe sources');
  const recipeTree = text(row.recipeTree, /^[a-f0-9]{40}$/);
  if (recipeTreeIdentity(recipeFiles) !== recipeTree) throw Error('Pinned recipe tree mismatch');
  return {
    origin: sourceName(row.origin),
    version: text(row.version, /^[A-Za-z0-9_.-]+$/),
    packageVersion: text(row.packageVersion, /^[A-Za-z0-9_.-]+$/),
    aportsCommit: text(row.aportsCommit, /^[a-f0-9]{40}$/),
    recipeTree,
    recipeFiles,
    remote,
    sourceChecksums,
  };
}
function upstream(value: unknown): UpstreamSource {
  const row = sourceRecord(value);
  return {
    name: sourceName(row.name),
    version: text(row.version, /^[A-Za-z0-9_.-]+$/),
    file: sourceName(row.file),
    url: sourceUrl(row.url),
    sha256: text(row.sha256, /^[a-f0-9]{64}$/),
    bytes: bounded(row.bytes, 200 * 1024 ** 2),
  };
}
function captureK6(value: unknown, originals: readonly UpstreamSource[]): K6Source {
  const binary = sourceRecord(value);
  const k6Binary = {
    version: text(binary.version, /^\d+\.\d+\.\d+$/),
    revision: text(binary.revision, /^[a-f0-9]{40}$/),
    observedArm64BinarySha256: text(binary.observedArm64BinarySha256, /^[a-f0-9]{64}$/),
    baseImage: text(binary.baseImage, /^grafana\/k6:\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/),
  };
  const k6 = originals.find((item) => item.name === 'k6')!;
  if (
    k6.version !== k6Binary.revision ||
    k6.url !== `https://api.github.com/repos/grafana/k6/tarball/${k6Binary.revision}` ||
    !k6Binary.baseImage.startsWith(`grafana/k6:${k6Binary.version}@`)
  )
    throw Error('k6 source provenance mismatch');
  return k6Binary;
}
export function captureSourceCatalog(value: unknown): SourceCatalog {
  const row = sourceRecord(value);
  if (row.format !== 'beetle-third-party-sources' || row.version !== 1) throw Error('Source catalog version invalid');
  const components = list(row.alpine, 32).map(alpine);
  const originals = list(row.upstream, 3).map(upstream);
  if (new Set(components.map((item) => item.origin)).size !== components.length || !components.length)
    throw Error('Duplicate source origins');
  if (originals.length !== 3 || !['node', 'nginx', 'k6'].every((name) => originals.some((item) => item.name === name)))
    throw Error('Required upstream sources missing');
  const k6Binary = captureK6(row.k6Binary, originals);
  return { format: 'beetle-third-party-sources', version: 1, alpine: components, upstream: originals, k6Binary };
}
import { createHash } from 'node:crypto';
