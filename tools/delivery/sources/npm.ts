import {createHash} from 'node:crypto';
import {sourceRecord, sourceUrl} from './catalog.js';
export interface NpmSource {name: string; version: string; url: string; sha512: string; file: string}
function sourcePackage(path: string, row: Record<string, unknown>): NpmSource | undefined {
  if (!path.includes('node_modules/') || row.dev === true || row.link === true) return;
  return pinnedPackage(path, row);
}
function pinnedPackage(path: string, row: Record<string, unknown>): NpmSource {
  const url = sourceUrl(row.resolved); const location = new URL(url);
  if (location.hostname !== 'registry.npmjs.org' || location.search) throw Error('Pinned npm registry required');
  if (typeof row.version !== 'string' || !/^[A-Za-z0-9_.+-]{1,120}$/.test(row.version)
    || typeof row.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(row.integrity)) throw Error('Pinned npm integrity required');
  const name = path.slice(path.lastIndexOf('node_modules/') + 13);
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]{1,180}$/.test(name)) throw Error('Invalid npm source name');
  return {name, version: row.version, url, sha512: Buffer.from(row.integrity.slice(7), 'base64').toString('hex'),
    file: createHash('sha256').update(url).digest('hex') + '.tgz'};
}
/** Full production tarballs retain copyright/license files discarded by JavaScript bundling. */
export function npmSources(input: unknown): readonly NpmSource[] {
  const lock = sourceRecord(input); if (lock.lockfileVersion !== 3) throw Error('Source lockfile version invalid');
  const packages = sourceRecord(lock.packages); if (Object.keys(packages).length > 4096) throw Error('Source dependency bound');
  const sources = new Map<string, NpmSource>();
  for (const [path, value] of Object.entries(packages)) {
    const source = sourcePackage(path, sourceRecord(value)); if (!source) continue;
    const prior = sources.get(source.url);
    if (prior && (prior.sha512 !== source.sha512 || prior.version !== source.version)) throw Error('Conflicting npm source identity');
    sources.set(source.url, source);
  }
  if (!sources.size || sources.size > 512) throw Error('Production npm source count bound'); return Object.freeze([...sources.values()]);
}
