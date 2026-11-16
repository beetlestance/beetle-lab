import { finalizationFixture } from '../output-finalization/fixture.js';
import { descriptor } from '../output-transfer/peer-fixture.js';
import { fixture, context, finish } from '../files/output-bytes/fixture.js';
import type { OutputFileRecord, OutputFileReceipt } from '../../src/ports/output-bytes.js';
import { uuid } from '../storage/fixture.js';
export async function published(contents: Buffer[], kinds?: readonly string[]) {
  if (kinds && kinds.length !== contents.length) throw new Error('Invalid kind fixture');
  const f = finalizationFixture({artifacts: contents.map((bytes, ordinal) => ({...descriptor(bytes, ordinal),
    ...(kinds ? {kind: kinds[ordinal]!} : {})}))}); f.ready(); const files = await fixture();
  const writerId = uuid(800);
  for (const [ordinal, bytes] of contents.entries()) {
    const key = {binding: f.binding, manifestDigest: f.envelope.manifest.manifestDigest, sourceDigest: f.envelope.sourceDigest, ordinal};
    let record = f.outputs.execute({kind: 'outputClaimArtifact', request: {key, writerId, expectedVersion: 1}}) as OutputFileRecord;
    const progress = (receipt: OutputFileReceipt) => {
      record = f.outputs.execute({kind: 'outputRecordProgress', request: {key, writerId, expectedVersion: record.artifact.version, receipt}}) as OutputFileRecord;
    };
    progress(await finish(files.store.prepare(record, context())));
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      progress(await finish(files.store.append({record, offset, bytes: bytes.subarray(offset, offset + 65536)}, context())));
    }
    record = f.outputs.execute({kind: 'outputBeginPublication', request: {key, writerId, expectedVersion: record.artifact.version}}) as OutputFileRecord;
    const receipt = await finish(files.store.publish(record, context()));
    f.outputs.execute({kind: 'outputRecordPublication', request: {key, writerId, expectedVersion: record.artifact.version, receipt}});
  }
  if (f.finalize().kind !== 'finalized') throw new Error('Synthetic publication not finalized');
  return {...f, files};
}
