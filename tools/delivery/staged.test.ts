import {expect, it} from 'vitest';
import {verifyRoundtrip} from './staged.js';
import type {DeliveryBundle} from './bundle.js';
import {candidateRoles} from './identity.js';
function fixture() {
  const images = Object.fromEntries(candidateRoles.map((role, index) => [role, `sha256:${String(index + 1).repeat(64)}`])) as DeliveryBundle['images'];
  const configs = Object.fromEntries(candidateRoles.map((role, index) => [role, `sha256:${String(index + 2).repeat(64)}`])) as DeliveryBundle['configs'];
  const bundle: DeliveryBundle = {format: 'beetle-qualified-images', version: 2, revision: 'a'.repeat(40), architecture: 'arm64',
    images, configs, references: images, archive: {name: 'images.tar.gz', bytes: 100, sha256: 'b'.repeat(64), uncompressedBytes: 200}};
  const proof = {format: 'beetle-image-roundtrip', version: 1, status: 'passed', revision: bundle.revision, architecture: bundle.architecture,
    sourceImageIds: {...images}, configDigests: {...configs}, restoredImageIds: {...configs}, archiveSha256: bundle.archive.sha256, store: 'fresh-private-vfs'};
  return {bundle, proof};
}
it('binds the restored classic config IDs separately from original manifest IDs', () => {
  const f = fixture(); expect(() => verifyRoundtrip(f.proof, f.bundle)).not.toThrow();
  f.proof.restoredImageIds = {...f.bundle.images};
  expect(() => verifyRoundtrip(f.proof, f.bundle)).toThrow('identity mismatch');
});
it.each(['revision', 'architecture', 'archiveSha256', 'store', 'status'])('refuses mismatched restoration %s', field => {
  const f = fixture(); Object.assign(f.proof, {[field]: 'other'});
  expect(() => verifyRoundtrip(f.proof, f.bundle)).toThrow();
});
it('requires all six exact identities for each stage without extra role fields', () => {
  for (const field of ['sourceImageIds', 'configDigests', 'restoredImageIds'] as const) {
    const f = fixture(); Object.assign(f.proof[field], {frontend: 'sha256:' + 'f'.repeat(64)});
    expect(() => verifyRoundtrip(f.proof, f.bundle)).toThrow('identity mismatch');
    const g = fixture(); Object.assign(g.proof[field], {extra: g.bundle.configs.agent});
    expect(() => verifyRoundtrip(g.proof, g.bundle)).toThrow('identity mismatch');
  }
});
