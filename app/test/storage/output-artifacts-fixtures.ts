import type { OutputFileRecord } from '../../src/ports/output-bytes.js';
import type { OutputArtifactClaim } from '../../src/ports/output-artifacts.js';
import type { ArtifactOperation } from '../../src/adapters/outbound/sqlite/output-artifacts/index.js';
import { fixture, artifact } from './output-custody-fixtures.js';
export const writerId = '12345678-1234-4234-8234-123456789012';
export const stageIdentity = 'd'.repeat(64);
export const publishedIdentity = 'e'.repeat(64);
export function artifactsFixture(bytes = 32) {
  const f = fixture(10000, [{...artifact, bytes}]); f.adopt();
  const key = {binding: f.binding, manifestDigest: f.envelope.manifest.manifestDigest,
    sourceDigest: f.envelope.sourceDigest, ordinal: 0};
  const request = (expectedVersion = 1): OutputArtifactClaim => ({key, writerId, expectedVersion});
  const execute = (operation: ArtifactOperation) => f.outputs.execute(operation) as OutputFileRecord;
  const claim = () => execute({kind: 'outputClaimArtifact', request: request()});
  const progress = (record: OutputFileRecord, offset: number, identity = stageIdentity, expectedVersion = record.artifact.version) =>
    execute({kind: 'outputRecordProgress', request: {...request(expectedVersion),
      receipt: {token: record.artifact.token, offset, phase: 'transferring', identity}}});
  const begin = (record: OutputFileRecord) => execute({kind: 'outputBeginPublication', request: request(record.artifact.version)});
  const publish = (record: OutputFileRecord, identity = publishedIdentity) => execute({kind: 'outputRecordPublication',
    request: {...request(record.artifact.version), receipt: {token: record.artifact.token, offset: bytes, phase: 'published', identity}}});
  const slots = () => f.db.prepare('SELECT * FROM execution_output_slots').all();
  const facts = () => [...f.facts(), slots(), f.db.prepare('SELECT * FROM execution_output_sources').all()];
  return {...f, key, request, execute, claim, progress, begin, publish, slots, allFacts: facts};
}
