import { candidateRoles } from '../../delivery/identity.js';
import { object } from '../../delivery/registry/descriptors.js';
import { capturePublishedPlan, releaseTag } from '../../delivery/registry/value.js';
export function qualificationTag(value: string): string {
  if (!/^rewrite-[a-f0-9]{40}-[1-9][0-9]{0,15}$/.test(value)) throw Error('Canonical public rewrite tag required');
  const run = Number(value.split('-')[2]);
  if (!Number.isSafeInteger(run)) throw Error('Release run bound');
  return value;
}
function assetIntegrity(asset: Record<string, unknown>) {
  if (
    asset.state !== 'uploaded' ||
    typeof asset.size !== 'number' ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 262144 ||
    typeof asset.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  )
    throw Error('Publication asset integrity required');
  return { bytes: asset.size, sha256: asset.digest.slice(7) };
}
export function publicationAsset(input: unknown, tag: string) {
  qualificationTag(tag);
  const row = object(input);
  if (row.tag_name !== tag || row.draft !== false || !Array.isArray(row.assets) || row.assets.length > 100)
    throw Error('Public release required');
  const matches = row.assets.map(object).filter((asset) => asset.name === 'publication.json');
  if (matches.length !== 1) throw Error('Unique publication asset required');
  return assetIntegrity(matches[0]!);
}
export function qualificationPlan(input: unknown, tag: string) {
  qualificationTag(tag);
  const plan = capturePublishedPlan(input);
  if (object(input).anonymousQualification !== 'passed' || releaseTag(plan) !== tag)
    throw Error('Completed matching public candidate required');
  return plan;
}

export function qualificationRoles(mode: string) {
  if (mode === 'engine') return ['engine'] as const;
  if (mode === 'stack') return [...candidateRoles];
  throw Error('Pull profile must be engine or stack');
}
