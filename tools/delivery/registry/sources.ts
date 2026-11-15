import {join} from 'node:path';
import {candidateRoles} from '../identity.js';
import type {DeliveryBundle} from '../bundle.js';
import {deliveryDigest, readDeliveryJson} from '../files.js';
import {object} from './descriptors.js';
function sourceBundle(input: unknown, revision: string) {
  const source = object(input); const archive = object(source.archive);
  if (source.format !== 'beetle-source-bundle' || source.version !== 1 || source.revision !== revision
    || archive.name !== 'sources.tar.gz' || !Array.isArray(source.candidates) || source.candidates.length !== 2) throw Error('Completed candidate source bundle required');
  return {source, archive, candidates: source.candidates.map(object)};
}
function sourcePlatforms(candidates: readonly Record<string, unknown>[], bundles: readonly DeliveryBundle[]): void {
  for (const bundle of bundles) {
    const matches = candidates.filter(row => row.architecture === bundle.architecture);
    if (matches.length !== 1) throw Error('Source bundle platform missing');
    const configs = object(matches[0]!.configs);
    if (Object.keys(configs).length !== 6 || candidateRoles.some(role => configs[role] !== bundle.configs[role])) throw Error('Source bundle config binding mismatch');
  }
}
export async function registrySources(directory: string, bundles: readonly DeliveryBundle[]) {
  const {source, archive, candidates} = sourceBundle(await readDeliveryJson(join(directory, 'source-bundle.json')), bundles[0]!.revision);
  sourcePlatforms(candidates, bundles);
  const actual = await deliveryDigest(join(directory, 'sources.tar.gz'), 640 * 1024 ** 2);
  if (actual.bytes !== archive.bytes || actual.sha256 !== archive.sha256) throw Error('Source bundle archive hash mismatch');
  return {bytes: actual.bytes, sha256: actual.sha256,
    url: `https://github.com/beetlestance/beetle-lab/releases/download/rewrite-${source.revision}/sources-${actual.sha256}.tar.gz`};
}
