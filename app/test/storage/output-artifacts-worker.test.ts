import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { storageFixture, observation, settingsFixture } from './fixture.js';
import { fixture, artifact } from './output-custody-fixtures.js';
import { artifactsFixture, stageIdentity, writerId } from './output-artifacts-fixtures.js';
import { fixture as byteFixture, finish, context } from '../files/output-bytes/fixture.js';
import type { Operation } from '../../src/adapters/outbound/sqlite/protocol.js';
const storage = storageFixture();
async function discardReplies(path: string, config: ReturnType<typeof artifactsFixture>['config'], operations: Operation[]) {
  const worker = new Worker(storage.workerUrl(), {workerData: {path,
    bootstrap: {installation: settingsFixture().chain.installation, runtime: observation(), runs: config}}});
  try {
    await new Promise<void>((resolve, reject) => {
      let sent = 0; worker.once('error', reject);
      const next = () => { const operation = operations[sent++]; if (operation) worker.postMessage({...operation, messageId: sent}); else resolve(); };
      worker.on('message', (message: {kind: string; ok?: boolean; code?: string}) => {
        if (message.kind === 'ready') next();
        if (message.kind === 'startup_error' || message.kind === 'result' && !message.ok) reject(new Error(`Worker refused original: ${message.code}`));
        // Each actual COMMIT precedes its discarded transport reply.
        if (message.kind === 'result' && message.ok) next();
      });
    });
  } finally { await worker.terminate(); }
}
it('recovers the same writer/token/progress and publication after discarded actual worker replies and reopen', async () => {
  const f = artifactsFixture(); const path = storage.path(); const token = f.slots()[0]!.slot_json;
  const parsed = JSON.parse(String(token)) as {t: string}; f.db.prepare('VACUUM INTO ?').run(path);
  const receipt = {token: parsed.t, offset: 32, phase: 'transferring', identity: stageIdentity} as const;
  await discardReplies(path, f.config, [{kind: 'outputClaimArtifact', request: f.request()},
    {kind: 'outputRecordProgress', request: {...f.request(2), receipt}}]);
  let metadata = await storage.open(path, {runs: f.config});
  const progress = await metadata.outputs.claimArtifact(f.request());
  expect(progress.artifact).toMatchObject({writer: writerId, token: parsed.t, offset: 32, identity: stageIdentity, version: 3});
  expect(await metadata.outputs.recordProgress({...f.request(2), receipt})).toEqual(progress);
  await storage.close(metadata);
  const publication = {...receipt, phase: 'published', identity: 'e'.repeat(64)} as const;
  await discardReplies(path, f.config, [{kind: 'outputBeginPublication', request: f.request(3)},
    {kind: 'outputRecordPublication', request: {...f.request(4), receipt: publication}}]);
  metadata = await storage.open(path, {runs: f.config});
  const published = await metadata.outputs.recordPublication({...f.request(4), receipt: publication});
  expect(published.artifact).toMatchObject({phase: 'published', writer: null, offset: 32, version: 5});
  expect(await metadata.outputs.claimArtifact(f.request())).toEqual(published);
  expect(await metadata.outputs.adopt({binding: f.binding, envelope: f.envelope})).toMatchObject({version: 1, artifacts: [published.artifact]});
});
it('serializes racing claims through the compiled worker and rejects oversize, stale and cross-source requests', async () => {
  const f = artifactsFixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, {runs: f.config});
  const results = await Promise.allSettled([metadata.outputs.claimArtifact(f.request()),
    metadata.outputs.claimArtifact({...f.request(), writerId: '22222222-2222-4222-8222-222222222222'})]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  await expect(metadata.outputs.recordProgress({...f.request(1), receipt: {token: JSON.parse(String(f.slots()[0]!.slot_json)).t as string,
    offset: 1, phase: 'transferring', identity: stageIdentity}})).rejects.toMatchObject({code: 'conflict'});
  await expect(metadata.outputs.claimArtifact({...f.request(2), key: {...f.key, sourceDigest: 'f'.repeat(64)}})).rejects.toMatchObject({code: 'conflict'});
  await expect(metadata.outputs.claimArtifact({...f.request(), writerId: 'x'.repeat(4097)})).rejects.toMatchObject({code: 'invalid_input'});
});
it.each(['synthetic artifact bytes', ''])('composes real native ByteStore receipts with compiled Metadata: %j', async text => {
  const bytes = Buffer.from(text);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const f = fixture(10000, [{...artifact, bytes: bytes.length, sha256}]); const path = storage.path();
  f.db.prepare('VACUUM INTO ?').run(path); const metadata = await storage.open(path, {runs: f.config});
  const adopted = await metadata.outputs.adopt({binding: f.binding, envelope: f.envelope});
  expect(adopted).toMatchObject({manifestDigest: f.envelope.manifest.manifestDigest});
  const key = {binding: f.binding, manifestDigest: f.envelope.manifest.manifestDigest, sourceDigest: f.envelope.sourceDigest, ordinal: 0};
  const request = (expectedVersion: number) => ({key, writerId, expectedVersion});
  const files = await byteFixture();
  try {
    let record = await metadata.outputs.claimArtifact(request(1));
    const prepared = await finish(files.store.prepare(record, context()));
    record = await metadata.outputs.recordProgress({...request(record.artifact.version), receipt: prepared});
    if (bytes.length) {
      const appended = await finish(files.store.append({record, offset: 0, bytes}, context()));
      record = await metadata.outputs.recordProgress({...request(record.artifact.version), receipt: appended});
    }
    record = await metadata.outputs.beginPublication(request(record.artifact.version));
    const publication = await finish(files.store.publish(record, context()));
    expect(publication.phase).toBe('published'); expect(publication.identity).not.toBe(prepared.identity);
    record = await metadata.outputs.recordPublication({...request(record.artifact.version), receipt: publication});
    const received: Buffer[] = [];
    await finish(files.store.read({record, start: 0, endExclusive: bytes.length, sink: {async write(chunk) {received.push(Buffer.from(chunk));}}}, context()));
    expect(Buffer.concat(received)).toEqual(bytes);
    await storage.close(metadata);
    const reopened = await storage.open(path, {runs: f.config});
    expect(await reopened.outputs.claimArtifact(request(1))).toEqual(record);
    expect(await reopened.outputs.readSource(f.binding)).toEqual(f.envelope);
  } finally { await files.dispose(); }
});
it('keeps the highest durable offset under overlapping compiled-worker CAS and equal replay', async () => {
  const f = artifactsFixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, {runs: f.config}); const claimed = await metadata.outputs.claimArtifact(f.request());
  const receipt = {token: claimed.artifact.token, offset: 10, identity: stageIdentity, phase: 'transferring'} as const;
  const results = await Promise.allSettled([metadata.outputs.recordProgress({...f.request(2), receipt}),
    metadata.outputs.recordProgress({...f.request(2), receipt: {...receipt, offset: 20}})]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  const high = await metadata.outputs.recordProgress({...f.request(3), receipt: {...receipt, offset: 20}});
  expect(high.artifact).toMatchObject({offset: 20, version: 4});
  expect(await metadata.outputs.recordProgress({...f.request(2), receipt})).toEqual(high);
});
