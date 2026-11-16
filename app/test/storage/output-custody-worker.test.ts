import { expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { storageFixture, observation, settingsFixture } from './fixture.js';
import { fixture, artifact } from './output-custody-fixtures.js';
const storage = storageFixture();
it('reopens an actual committed worker adoption after discarded reply with identical one-body state and tokens', async () => {
  const f = fixture(10000, [artifact]); const path = storage.path();
  f.db.prepare('VACUUM INTO ?').run(path);
  const bootstrap = {installation: settingsFixture().chain.installation, runtime: observation(), runs: f.config};
  const worker = new Worker(storage.workerUrl(), {workerData: {path, bootstrap}});
  await new Promise<void>((resolve, reject) => {
    worker.once('error', reject);
    worker.on('message', (message: {kind: string; ok?: boolean}) => {
      if (message.kind === 'ready') worker.postMessage({messageId: 1, kind: 'outputAdopt', request: {binding: f.binding, envelope: f.envelope}});
      if (message.kind === 'startup_error' || message.kind === 'result' && !message.ok) reject(new Error('Worker refused original'));
      // The actual original COMMIT precedes this transport reply. Discard its value.
      if (message.kind === 'result' && message.ok) resolve();
    });
  });
  await worker.terminate();
  const metadata = await storage.open(path, {runs: f.config});
  const source = await metadata.outputs.readSource(f.binding);
  expect(source).toEqual(f.envelope);
  const first = await metadata.outputs.load(f.binding);
  expect(first).toMatchObject({kind: 'adopted', artifacts: [{ordinal: 0, offset: 0, version: 1}]});
  expect(await metadata.outputs.adopt({binding: f.binding, envelope: f.envelope})).toEqual(first);
  await storage.close(metadata);
  const reopened = await storage.open(path, {runs: f.config});
  expect(await reopened.outputs.load(f.binding)).toEqual(first);
  expect(await reopened.outputs.readSource(f.binding)).toEqual(source);
});
it('reserves shared large originals before bounded capture and rejects oversized/accessor requests', async () => {
  const f = fixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, {runs: f.config});
  const first = metadata.outputs.readSource(f.binding); const second = metadata.outputs.readSource(f.binding);
  await expect(metadata.outputs.readSource(f.binding)).rejects.toMatchObject({code: 'queue_full'});
  expect(await first).toBeNull(); expect(await second).toBeNull();
  await expect(metadata.outputs.adopt({binding: f.binding, envelope: {padding: 'a'.repeat(79873)}}))
    .rejects.toMatchObject({code: 'invalid_input'});
  const envelope = Object.defineProperty({}, 'manifest', {enumerable: true, get: () => {throw new Error('Accessor invoked');}});
  await expect(metadata.outputs.adopt({binding: f.binding, envelope})).rejects.toMatchObject({code: 'invalid_input'});
  expect(await metadata.outputs.load(f.binding)).toEqual({kind: 'pending', binding: f.binding});
});
