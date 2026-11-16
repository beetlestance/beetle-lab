import {join} from 'node:path';
import {unlink} from 'node:fs/promises';
import {candidateRoles, captureQualifiedImages, maximumArchiveBytes} from './identity.js';
import {captureBundle} from './bundle.js';
import type {DeliveryBundle} from './bundle.js';
import {deliveryDigest, readDeliveryJson} from './files.js';
import {archiveProducer} from './producer.js';
import {archiveConfigs, archiveMember} from './contents.js';
import type {Architecture} from './identity.js';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Staged identity object required');
  return value as Record<string, unknown>;
}
function sameImages(input: unknown, expected: DeliveryBundle['images']): void {
  const images = record(input);
  if (Object.keys(images).length !== 6 || candidateRoles.some(role => images[role] !== expected[role])) throw Error('Staged image identity mismatch');
}
/** A matching revision label or filename alone does not establish restored identity. */
export function verifyRoundtrip(input: unknown, bundle: DeliveryBundle): void {
  const proof = record(input);
  if (Object.keys(proof).length !== 10 || proof.format !== 'beetle-image-roundtrip' || proof.version !== 1
    || proof.status !== 'passed' || proof.revision !== bundle.revision || proof.architecture !== bundle.architecture
    || proof.archiveSha256 !== bundle.archive.sha256 || proof.store !== 'fresh-private-vfs') throw Error('Unqualified staged roundtrip');
  sameImages(proof.sourceImageIds, bundle.images); sameImages(proof.configDigests, bundle.configs);
  sameImages(proof.restoredImageIds, bundle.configs);
}
export async function verifyStagedCandidate(directory: string, revision: string, architecture: Architecture): Promise<DeliveryBundle> {
  const images = join(directory, 'images'); const scans = join(directory, 'supply-chain');
  const bundle = captureBundle(await readDeliveryJson(join(images, 'bundle.json')));
  if (bundle.revision !== revision || bundle.architecture !== architecture) throw Error('Mixed staged revision or architecture');
  const outcome = await readDeliveryJson(join(directory, 'native', 'outcome.json'));
  const inspections = Object.fromEntries(await Promise.all(candidateRoles.map(async role =>
    [role, await readDeliveryJson(join(scans, `${role}.identity.json`))])));
  const qualified = captureQualifiedImages(revision, architecture, outcome, inspections);
  sameImages(bundle.images, qualified.images);
  verifyRoundtrip(await readDeliveryJson(join(directory, 'roundtrip', 'roundtrip.json')), bundle);
  const compressed = join(images, bundle.archive.name); const checksum = await deliveryDigest(compressed, maximumArchiveBytes);
  if (checksum.bytes !== bundle.archive.bytes || checksum.sha256 !== bundle.archive.sha256) throw Error('Staged archive hash mismatch');
  const tar = join(images, 'verified-images.tar');
  await archiveProducer({executable: 'gzip', args: ['-dc', compressed], destination: tar, maximumBytes: bundle.archive.uncompressedBytes});
  const actual = await deliveryDigest(tar, bundle.archive.uncompressedBytes);
  if (actual.bytes !== bundle.archive.uncompressedBytes) throw Error('Staged tar size mismatch');
  sameImages(archiveConfigs(archiveMember(tar), bundle.references, bundle), bundle.configs);
  await unlink(tar); return bundle;
}
