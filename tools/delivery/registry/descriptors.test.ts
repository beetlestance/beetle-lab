import {expect, it} from 'vitest';
import {candidateRoles} from '../identity.js';
import type {DeliveryBundle} from '../bundle.js';
import {archivePlatformImages, captureRoleIndex, captureImageManifest, hash, verifyImportedConfig} from './descriptors.js';
import type {PlatformImage} from './descriptors.js';
const revision = 'a'.repeat(40);
function fixture() {
  const files = new Map<string, Buffer>(); const configs: Record<string, string> = {}; const descriptors = [];
  for (const role of candidateRoles) {
    const config = Buffer.from(JSON.stringify({os: 'linux', architecture: 'amd64', config: {Labels: {'org.opencontainers.image.revision': revision, role}}}));
    const configId = hash(config); files.set('blobs/sha256/' + configId.slice(7), config); configs[role] = configId;
    const raw = Buffer.from(JSON.stringify({schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {digest: configId, size: config.length, mediaType: 'application/vnd.oci.image.config.v1+json'}, layers: []}));
    const digest = hash(raw); files.set('blobs/sha256/' + digest.slice(7), raw);
    descriptors.push({digest, size: raw.length, mediaType: 'application/vnd.oci.image.manifest.v1+json', annotations: {'org.opencontainers.image.ref.name': 'transport'}});
  }
  files.set('index.json', Buffer.from(JSON.stringify({schemaVersion: 2, manifests: descriptors})));
  const bundle = {format: 'beetle-qualified-images', version: 2, revision, architecture: 'amd64', configs, images: configs,
    references: configs, archive: {name: 'images.tar.gz', bytes: 1, sha256: 'b'.repeat(64), uncompressedBytes: 1}} as DeliveryBundle;
  return {bundle, files, read: (name: string) => {const file = files.get(name); if (!file) throw Error('Missing synthetic blob'); return file;}};
}
it('selects every source role by its config digest despite all six short transport tags colliding', () => {
  const f = fixture(); const images = archivePlatformImages(f.read, f.bundle);
  expect(Object.keys(images).sort()).toEqual([...candidateRoles].sort());
  expect(new Set(Object.values(images).map(image => image.digest)).size).toBe(6);
  for (const role of candidateRoles) {
    expect(images[role].config).toBe(f.bundle.configs[role]);
    expect(() => verifyImportedConfig(f.read('blobs/sha256/' + images[role].config.slice(7)), images[role], revision)).not.toThrow();
  }
});
it('rejects altered manifest bytes, duplicate role configs and wrong imported platform/revision', () => {
  const f = fixture(); const images = archivePlatformImages(f.read, f.bundle); const selected = images.frontend;
  expect(() => captureImageManifest(Buffer.from('{}'), selected)).toThrow('digest mismatch');
  const ambiguous = {...f.bundle, configs: {...f.bundle.configs, backend: selected.config}};
  expect(() => archivePlatformImages(f.read, ambiguous)).toThrow('ambiguous');
  const bytes = f.read('blobs/sha256/' + selected.config.slice(7));
  expect(() => verifyImportedConfig(bytes, {...selected, architecture: 'arm64'}, revision)).toThrow('platform or revision');
  expect(() => verifyImportedConfig(bytes, selected, 'c'.repeat(40))).toThrow('platform or revision');
});
it('requires exactly the two expected native manifests with their original platforms and sizes', () => {
  const f = fixture(); const first = archivePlatformImages(f.read, f.bundle).frontend;
  const second: PlatformImage = {...first, architecture: 'arm64', digest: 'sha256:' + 'c'.repeat(64)};
  const images = [first, second];
  const index = {schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: images.map(image =>
    ({digest: image.digest, size: image.size, mediaType: image.mediaType, platform: {os: 'linux', architecture: image.architecture}}))};
  const raw = () => Buffer.from(JSON.stringify(index));
  expect(captureRoleIndex(raw(), images).digest).toBe(hash(raw()));
  expect(() => captureRoleIndex(raw(), [first, first])).toThrow('Two-platform');
  index.manifests[1]!.platform.architecture = 'amd64'; expect(() => captureRoleIndex(raw(), images)).toThrow('identity mismatch');
  index.manifests[1]!.platform.architecture = 'arm64'; index.manifests[1]!.size++;
  expect(() => captureRoleIndex(raw(), images)).toThrow('identity mismatch');
});
