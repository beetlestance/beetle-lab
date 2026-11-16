import { encodeCanonicalJson, encodeJson } from './json.js';
import { validate } from './validate.js';
import type { InstalledIdentity } from './generated/types.js';
import type { ResultDigest } from './result-seal.js';

export const installedManifestPrefix = 'beetle-lab.installed-manifest.v1\n';
export const installedProfilePrefix = 'beetle-lab.installed-profile.v1\n';
export type InstalledLabels = Pick<InstalledIdentity, 'manifestId' | 'profileId' | 'catalogVersion' | 'schemaDigest'>;
export interface InstalledIdentityInput { manifest: unknown; profile: unknown; identity: InstalledLabels }
export class InstalledIdentityError extends Error {
  constructor(readonly code: 'invalid_descriptor' | 'digest_failed') { super('Installed identity rejected'); }
}
const fields = ['manifestId', 'profileId', 'catalogVersion', 'manifestDigest', 'profileDigest', 'schemaDigest'] as const;
function hashed(text: string, digest: ResultDigest): string {
  try {
    const result = digest(text);
    if (typeof result !== 'string' || !/^[a-f0-9]{64}$/.test(result)) throw new Error();
    return result;
  } catch { throw new InstalledIdentityError('digest_failed'); }
}
/** Content identity only; callers authenticate and validate their actual installed snapshots. */
export function installedDescriptorDigest(kind: 'manifest' | 'profile', input: unknown, digest: ResultDigest): string {
  let text: string;
  try {
    text = encodeCanonicalJson(input, 65536);
    const copy: unknown = JSON.parse(text);
    if (copy === null || typeof copy !== 'object' || Array.isArray(copy)) throw new Error();
    if (kind === 'manifest' && !validate('EngineManifest', copy).ok) throw new Error();
    if (kind !== 'manifest' && kind !== 'profile') throw new Error();
  } catch { throw new InstalledIdentityError('invalid_descriptor'); }
  return hashed((kind === 'manifest' ? installedManifestPrefix : installedProfilePrefix) + text, digest);
}
/** Digests come from complete bounded descriptors, never supplied digest labels. */
export function deriveInstalledIdentity(input: InstalledIdentityInput, digest: ResultDigest): Readonly<InstalledIdentity> {
  let copy: InstalledIdentityInput;
  try {
    copy = JSON.parse(encodeJson(input, 196608)) as InstalledIdentityInput;
    if (Object.keys(copy).sort().join(',') !== 'identity,manifest,profile') throw new Error();
    if (Object.keys(copy.identity).sort().join(',') !== 'catalogVersion,manifestId,profileId,schemaDigest') throw new Error();
    if (!validate('InstalledIdentity', { ...copy.identity, manifestDigest: '0'.repeat(64), profileDigest: '0'.repeat(64) }).ok) throw new Error();
  } catch { throw new InstalledIdentityError('invalid_descriptor'); }
  return Object.freeze({ ...copy.identity,
    manifestDigest: installedDescriptorDigest('manifest', copy.manifest, digest),
    profileDigest: installedDescriptorDigest('profile', copy.profile, digest) });
}
export function sameInstalledIdentity(left: InstalledIdentity, right: InstalledIdentity): boolean {
  return fields.every(field => left[field] === right[field]);
}
