import { finalizationFixture } from '../output-finalization/fixture.js';
import { fixture as filesFixture, context, finish } from '../files/output-bytes/fixture.js';
import { RunArtifacts } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import type { PublishedArtifactRead, RunArtifactsReader } from '../../src/ports/run-artifacts.js';
import type { OutputFileRecord, OutputFileReceipt } from '../../src/ports/output-bytes.js';
import type { RunArtifactPage } from '@beetle/contracts/api';
import { fixture as metricsFixture } from './fixture.js';
export async function nativeFixture(openFiles:()=>ReturnType<typeof filesFixture>=filesFixture) {
  const source = await metricsFixture(); const f = finalizationFixture({artifacts: source.descriptors}); f.ready();
  if (f.key.attempt.attemptId !== source.query.attemptId) throw new Error('Producer fixture scope does not match original metadata');
  const files = await openFiles(); const writerId = '00000000-0000-4000-8000-000000000800';
  for (const [ordinal, descriptor] of source.descriptors.entries()) {
    const bytes = source.contents.get(descriptor.artifactId)!;
    const key = {binding: f.binding, manifestDigest: f.envelope.manifest.manifestDigest, sourceDigest: f.envelope.sourceDigest, ordinal};
    let record = f.outputs.execute({kind: 'outputClaimArtifact', request: {key, writerId, expectedVersion: 1}}) as OutputFileRecord;
    const progress = (receipt: OutputFileReceipt) => {
      record = f.outputs.execute({kind: 'outputRecordProgress', request: {key, writerId, expectedVersion: record.artifact.version, receipt}}) as OutputFileRecord;
    };
    progress(await finish(files.store.prepare(record, context())));
    for (let offset = 0; offset < bytes.length; offset += 65536)
      progress(await finish(files.store.append({record, offset, bytes: bytes.subarray(offset, offset + 65536)}, context())));
    record = f.outputs.execute({kind: 'outputBeginPublication', request: {key, writerId, expectedVersion: record.artifact.version}}) as OutputFileRecord;
    const receipt = await finish(files.store.publish(record, context()));
    f.outputs.execute({kind: 'outputRecordPublication', request: {key, writerId, expectedVersion: record.artifact.version, receipt}});
  }
  if (f.finalize().kind !== 'finalized') throw new Error('Synthetic publication not finalized');
  const metadata = new RunArtifacts(f.db, f.reads);
  const reader: RunArtifactsReader = {
    async listRunArtifacts(query) {return metadata.execute({kind: 'listRunArtifacts', query}) as RunArtifactPage;},
    async getRunArtifact(key) {return metadata.execute({kind: 'getRunArtifact', key}) as PublishedArtifactRead;},
  };
  return {...f, files, reader, source};
}
