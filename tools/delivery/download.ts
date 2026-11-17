import { join, isAbsolute } from 'node:path';
import type { QualifiedArtifact } from './trust.js';
import { maximumArtifactZipBytes } from './identity.js';
import { archiveProducer } from './producer.js';
import { deliveryDigest } from './files.js';

function captureArtifact(input: QualifiedArtifact): void {
  if (
    !Number.isSafeInteger(input.id) ||
    input.id < 1 ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > maximumArtifactZipBytes ||
    !/^sha256:[a-f0-9]{64}$/.test(input.artifactDigest)
  )
    throw Error('Invalid immutable artifact download');
}
/** ZIP bytes have a different identity from bundle.archive.sha256 and OCI config/manifest hashes. */
export async function verifyArtifactArchive(artifact: QualifiedArtifact, path: string): Promise<void> {
  captureArtifact(artifact);
  const actual = await deliveryDigest(path, artifact.bytes);
  if (actual.bytes !== artifact.bytes || `sha256:${actual.sha256}` !== artifact.artifactDigest)
    throw Error('Immutable artifact ZIP digest mismatch');
}
/** Exclusive fixed leaf and authenticated immutable artifact-ID URL; bounded original process group. */
export async function downloadQualifiedArtifact(artifact: QualifiedArtifact, directory: string): Promise<string> {
  captureArtifact(artifact);
  if (!isAbsolute(directory) || directory.length > 4096) throw Error('Absolute artifact download directory required');
  const path = join(directory, `artifact-${artifact.id}.zip`);
  await archiveProducer({
    executable: 'gh',
    args: ['api', '--hostname', 'github.com', `repos/beetlestance/beetle-lab/actions/artifacts/${artifact.id}/zip`],
    destination: path,
    maximumBytes: artifact.bytes,
  });
  await verifyArtifactArchive(artifact, path);
  return path;
}
