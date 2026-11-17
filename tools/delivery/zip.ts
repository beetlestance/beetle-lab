import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { candidateRoles, maximumArchiveBytes } from './identity.js';
import { archiveProducer } from './producer.js';
import { downloadQualifiedArtifact } from './download.js';
import type { QualifiedArtifact } from './trust.js';
export type ArtifactKind = 'images' | 'native' | 'roundtrip' | 'supply-chain';
const scanNames = [
  ...candidateRoles.flatMap((role) =>
    ['scan.json', 'identity.json', 'licenses.json', 'cdx.json', 'gate.txt'].map((suffix) => `${role}.${suffix}`),
  ),
  'scanner.txt',
  'source-dependencies.cdx.json',
  'source-audit.json',
];
function expectedMembers(kind: Exclude<ArtifactKind, 'native'>): readonly string[] {
  return kind === 'images' ? ['bundle.json', 'images.tar.gz'] : kind === 'roundtrip' ? ['roundtrip.json'] : scanNames;
}
/** ZIP names never become filesystem paths or extraction directives. */
export function captureArtifactMembers(kind: ArtifactKind, listing: string): readonly string[] {
  if (listing.length > 65536 || !listing.endsWith('\n')) throw Error('Artifact ZIP directory bound');
  const names = listing.slice(0, -1).split('\n');
  if (names.length > 64 || new Set(names).size !== names.length) throw Error('Duplicate or excessive ZIP members');
  if (kind === 'native') {
    if (names.length !== 1 || !/^(?:beetle-compose-evidence-[A-Za-z0-9]{6}\/)?outcome\.json$/.test(names[0]!))
      throw Error('Unexpected native ZIP member');
  } else {
    const expected = expectedMembers(kind);
    if (names.length !== expected.length || names.some((name) => !expected.includes(name)))
      throw Error('Unexpected artifact ZIP member');
  }
  return Object.freeze(names);
}
function memberBound(kind: ArtifactKind, member: string, remaining: number): number {
  if (kind === 'images' && member === 'images.tar.gz') return maximumArchiveBytes;
  return kind === 'supply-chain' ? Math.min(5 * 1024 ** 2, remaining) : 262144;
}
/** Stream members to independently chosen exclusive regular leaves. No unzip-to-directory,
 * symlink following, wildcard filenames or pathname restoration is permitted. */
export async function extractQualifiedArtifact(
  artifact: QualifiedArtifact,
  kind: ArtifactKind,
  directory: string,
): Promise<void> {
  const archive = await downloadQualifiedArtifact(artifact, directory);
  const listing = join(directory, 'zip-members.txt');
  await archiveProducer({ executable: 'unzip', args: ['-Z1', archive], destination: listing, maximumBytes: 65536 });
  const names = captureArtifactMembers(kind, await readFile(listing, 'utf8'));
  let remaining = 50 * 1024 ** 2;
  for (const member of names) {
    const leaf = member.slice(member.lastIndexOf('/') + 1);
    const bytes = await archiveProducer({
      executable: 'unzip',
      args: ['-p', archive, member],
      destination: join(directory, leaf),
      maximumBytes: memberBound(kind, member, remaining),
    });
    if (kind === 'supply-chain') remaining -= bytes;
  }
}
