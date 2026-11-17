import { createHash } from 'node:crypto';
import { candidateRoles, imageIdentity } from '../identity.js';
import type { CandidateRole, Architecture } from '../identity.js';
import type { DeliveryBundle } from '../bundle.js';
import type { ArchiveMember } from '../contents.js';
export const imageMediaTypes = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
];
export interface ImageDescriptor {
  digest: string;
  size: number;
  mediaType: string;
}
export interface PlatformImage extends ImageDescriptor {
  architecture: Architecture;
  config: string;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Registry metadata object required');
  return value as Record<string, unknown>;
}
export function hash(bytes: Buffer): string {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}
function size(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw Error('Registry descriptor size bound');
  return value;
}
function descriptor(value: unknown, maximum: number): ImageDescriptor {
  const row = object(value);
  if (
    typeof row.mediaType !== 'string' ||
    row.mediaType.length > 128 ||
    row.urls !== undefined ||
    row.data !== undefined
  )
    throw Error('Local registry descriptor required');
  return { digest: imageIdentity(row.digest), size: size(row.size, maximum), mediaType: row.mediaType };
}
export function captureImageManifest(raw: Buffer, expected: ImageDescriptor): { config: ImageDescriptor } {
  if (raw.length !== expected.size || hash(raw) !== expected.digest) throw Error('Image manifest digest mismatch');
  const manifest = object(JSON.parse(raw.toString('utf8')));
  if (
    manifest.schemaVersion !== 2 ||
    !imageMediaTypes.includes(String(manifest.mediaType)) ||
    manifest.mediaType !== expected.mediaType ||
    !Array.isArray(manifest.layers) ||
    manifest.layers.length > 128
  )
    throw Error('Runnable image manifest required');
  const config = descriptor(manifest.config, 262144);
  for (const layer of manifest.layers) descriptor(layer, 500_000_000);
  return { config };
}
/** Digest selection avoids the archive's deliberately repeated short 'transport' tag. */
export function archivePlatformImages(
  read: ArchiveMember,
  bundle: DeliveryBundle,
): Readonly<Record<CandidateRole, PlatformImage>> {
  const index = object(JSON.parse(read('index.json').toString('utf8')));
  if (!Array.isArray(index.manifests) || index.manifests.length !== 6)
    throw Error('Six source OCI descriptors required');
  const selected = new Map<CandidateRole, PlatformImage>();
  for (const row of index.manifests) {
    const entry = descriptor(row, 262144);
    const raw = read('blobs/sha256/' + entry.digest.slice(7));
    const manifest = captureImageManifest(raw, entry);
    const matches = candidateRoles.filter((role) => bundle.configs[role] === manifest.config.digest);
    if (matches.length !== 1 || selected.has(matches[0]!)) throw Error('Source role config binding ambiguous');
    selected.set(matches[0]!, { ...entry, architecture: bundle.architecture, config: manifest.config.digest });
  }
  return Object.freeze(Object.fromEntries(selected) as Record<CandidateRole, PlatformImage>);
}
export function verifyImportedConfig(raw: Buffer, image: PlatformImage, revision: string): void {
  if (hash(raw) !== image.config) throw Error('Imported image config changed');
  const config = object(JSON.parse(raw.toString('utf8')));
  const labels = object(object(config.config).Labels);
  if (
    config.os !== 'linux' ||
    config.architecture !== image.architecture ||
    labels['org.opencontainers.image.revision'] !== revision
  )
    throw Error('Imported image platform or revision changed');
}
function requireRoleIndex(index: Record<string, unknown>, images: readonly PlatformImage[]): Record<string, unknown>[] {
  if (
    index.schemaVersion !== 2 ||
    index.mediaType !== 'application/vnd.oci.image.index.v1+json' ||
    !Array.isArray(index.manifests) ||
    index.manifests.length !== 2 ||
    images.length !== 2 ||
    new Set(images.map((image) => image.architecture)).size !== 2
  )
    throw Error('Two-platform index required');
  return index.manifests.map(object);
}
function verifyPlatform(row: Record<string, unknown>, image: PlatformImage): void {
  const platform = object(row.platform);
  if (
    row.size !== image.size ||
    row.mediaType !== image.mediaType ||
    platform.os !== 'linux' ||
    platform.architecture !== image.architecture
  )
    throw Error('Index platform identity mismatch');
}
export function captureRoleIndex(raw: Buffer, images: readonly PlatformImage[]): ImageDescriptor {
  const index = object(JSON.parse(raw.toString('utf8')));
  const entries = requireRoleIndex(index, images);
  for (const image of images) {
    const matches = entries.filter((row) => row.digest === image.digest);
    if (matches.length !== 1) throw Error('Index platform manifest missing');
    verifyPlatform(matches[0]!, image);
  }
  return { digest: hash(raw), size: raw.length, mediaType: String(index.mediaType) };
}
