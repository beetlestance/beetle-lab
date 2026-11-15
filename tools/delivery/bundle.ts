import {candidateRoles, revisionIdentity, architectureIdentity, imageIdentity, maximumArchiveBytes} from './identity.js';
import type {Architecture} from './identity.js';
import type {ImageReferences} from './references.js';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Archive bundle object required');
  return value as Record<string, unknown>;
}
function identities(value: unknown): ImageReferences {
  const row = record(value); if (Object.keys(row).length !== 6) throw Error('Six image identities required');
  return Object.fromEntries(candidateRoles.map(role => [role, imageIdentity(row[role])])) as Record<keyof ImageReferences, string>;
}
function references(value: unknown): ImageReferences {
  const row = record(value); if (Object.keys(row).length !== 6) throw Error('Six transport references required');
  let namespace: string | undefined;
  for (const role of candidateRoles) {
    const ref = row[role]; if (typeof ref !== 'string') throw Error('Archive reference required');
    const match = /^(beetle-qualified-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\/([a-z]+):transport$/.exec(ref);
    if (!match || match[2] !== role || namespace && namespace !== match[1]) throw Error('Invalid archive role reference');
    namespace = match[1];
  }
  return row as unknown as ImageReferences;
}
function bytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximumArchiveBytes) throw Error('Archive byte bound');
  return value;
}
export interface DeliveryBundle {
  readonly format: 'beetle-qualified-images'; readonly version: 2; readonly revision: string; readonly architecture: Architecture;
  readonly images: ImageReferences; readonly configs: ImageReferences; readonly references: ImageReferences;
  readonly archive: {readonly name: 'images.tar.gz'; readonly bytes: number; readonly sha256: string; readonly uncompressedBytes: number};
}
export function captureBundle(input: unknown): DeliveryBundle {
  const value = record(input); const archive = record(value.archive);
  if (value.format !== 'beetle-qualified-images' || value.version !== 2 || Object.keys(value).length !== 8
    || archive.name !== 'images.tar.gz' || Object.keys(archive).length !== 4
    || typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.sha256)) throw Error('Invalid delivery bundle');
  if (typeof value.revision !== 'string' || typeof value.architecture !== 'string') throw Error('Invalid delivery revision/platform');
  return {format: 'beetle-qualified-images', version: 2, revision: revisionIdentity(value.revision), architecture: architectureIdentity(value.architecture),
    images: identities(value.images), configs: identities(value.configs), references: references(value.references),
    archive: {name: 'images.tar.gz', bytes: bytes(archive.bytes), sha256: archive.sha256, uncompressedBytes: bytes(archive.uncompressedBytes)}};
}
