import type { Artifact } from '@beetle/contracts';
import { payloadFixture } from './output-payload-fixtures.js';
import { OutputCustody } from '../../src/adapters/outbound/sqlite/output-custody/index.js';
export const artifact: Artifact = {artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'raw', relativePath: 'data.bin', bytes: 32, sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z'};
export function fixture(maximum = 10000, artifacts: Artifact[] = []) {
  const f = payloadFixture(maximum);
  const manifest = f.manifest(artifacts); const sourceDigest = 'c'.repeat(64);
  const envelope = { version: 1, manifest, sourceDigest, closure: { version: 1, finalAgentSeq: 1,
    receipt: {version: 1, journalAuthority: f.binding.journalAuthority, key: { organizationId: f.key.attempt.organizationId,
      workspaceId: f.key.attempt.workspaceId, attemptId: f.key.attempt.attemptId, generation: 1 },
    manifestDigest: manifest.manifestDigest, sourceDigest} } } as const;
  const outputs = new OutputCustody(f.db, 'synthetic-installation');
  const adopt = () => outputs.execute({kind: 'outputAdopt', request: {binding: f.binding, envelope}});
  return {...f, outputs, envelope, adopt};
}
