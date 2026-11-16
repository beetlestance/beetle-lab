import { afterEach, expect, it } from 'vitest';
import { validatePrimitive } from '@beetle/contracts';
import { record as captureRecord } from '../../../src/adapters/outbound/files/outputs/capture.js';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, finish, fixture, record } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
it('rejects artifact ordinal 128 before native effects', async () => {
  let effects = 0;
  files = await fixture({ ...nativePort,
    lstat: async (...args) => { effects++; return nativePort.lstat(...args); },
    open: async (...args) => { effects++; return nativePort.open(...args); },
  });
  const value = record(); Object.assign(value.artifact, { ordinal: 128 }); effects = 0;
  const outcome = await finish(files.store.prepare(value, context())).then(receipt => ({ receipt }), error => ({ error: error as unknown }));
  expect.soft(outcome).toMatchObject({ error: { code: 'invalid_input' } }); expect.soft(effects).toBe(0);
});
it('preserves an uppercase declared artifactId across real prepare append publish and read', async () => {
  files = await fixture(); let value = record(); const artifactId = 'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF';
  expect(validatePrimitive('uuid', artifactId).ok).toBe(true);
  Object.assign(value.artifact, { ordinal: 127, artifactId });
  expect(captureRecord(value).artifact.artifactId).toBe(artifactId);
  value = advance(value, await finish(files.store.prepare(value, context())));
  value = advance(value, await finish(files.store.append({ record: value, offset: 0, bytes: Buffer.from('abc') }, context())));
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  value = advance(value, await finish(files.store.publish(value, context())), 'published');
  const chunks: Buffer[] = [];
  await finish(files.store.read({ record: value, start: 0, endExclusive: 3, sink: { write: async bytes => { chunks.push(Buffer.from(bytes)); } } }, context()));
  expect(Buffer.concat(chunks)).toEqual(Buffer.from('abc')); expect(value.artifact.artifactId).toBe(artifactId);
  const lowercase = { ...value, artifact: { ...value.artifact, artifactId: artifactId.toLowerCase() } };
  await expect(finish(files.store.prepare(lowercase, context()))).rejects.toMatchObject({ code: 'integrity' });
});
