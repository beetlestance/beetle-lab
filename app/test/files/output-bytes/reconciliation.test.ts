import { link, lstat, readFile, writeFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, finish, fixture, populated, record } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
it('reconciles publishing stage-only custody without creating a phase transition or reconstructing a file', async () => {
  files = await fixture(); let value = await populated(files);
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  const reconciled = await finish(files.store.prepare(value, context()));
  expect(reconciled).toMatchObject({ phase: 'transferring', identity: value.artifact.identity, offset: 3 });
  expect(value.artifact.phase).toBe('publishing'); expect(await readFile(files.path(value))).toEqual(Buffer.from('abc'));
  await expect(lstat(files.path(value, true))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('requires publish for ambiguous aliases and allows read-only preparation with a matched full published signature', async () => {
  let interrupted = false;
  files = await fixture({ ...nativePort, link: async (...args) => {
    await nativePort.link(...args); if (!interrupted) { interrupted = true; throw new Error('Synthetic link response loss'); }
  } });
  let value = await populated(files); value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  await expect(finish(files.store.publish(value, context()))).rejects.toMatchObject({ code: 'io' });
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'integrity' });
  value = advance(value, await finish(files.store.publish(value, context())), 'published');
  const noReads = await files.reopen({ ...nativePort, read: async () => { throw new Error('Unexpected whole-file scan'); } });
  expect((await finish(noReads.prepare(value, context()))).identity).toBe(value.artifact.identity);
});
it('rejects namespace and artifact identity changes while permitting metadata version/writer renewal', async () => {
  files = await fixture(); const value = await populated(files);
  const variants = [
    { ...value, binding: { ...value.binding, journalAuthority: '00000000-0000-4000-8000-000000000099' } },
    { ...value, binding: { ...value.binding, key: { ...value.binding.key, attempt: { ...value.binding.key.attempt, intentDigest: 'f'.repeat(64) } } } },
    { ...value, artifact: { ...value.artifact, ordinal: 1 } },
    { ...value, artifact: { ...value.artifact, artifactId: '00000000-0000-4000-8000-000000000099' } },
    { ...value, artifact: { ...value.artifact, sha256: 'f'.repeat(64) } },
    { ...value, artifact: { ...value.artifact, bytes: 4 } },
  ];
  for (const variant of variants) await expect(finish(files.store.prepare(variant, context()))).rejects.toMatchObject({ code: 'integrity' });
  const renewed = { ...value, artifact: { ...value.artifact, version: value.artifact.version + 1, writer: '00000000-0000-4000-8000-000000000099' } };
  expect((await finish(files.store.prepare(renewed, context()))).identity).toBe(value.artifact.identity);
});
it('withholds a positive receipt when the named signature changes during original close', async () => {
  let enabled = false; const paths = new Map<object, string>();
  files = await fixture({ ...nativePort,
    open: async (...args) => { const handle = await nativePort.open(...args); paths.set(handle, args[0]); return handle; },
    close: async handle => {
      const file = !(await handle.stat()).isDirectory(); const path = paths.get(handle)!; await nativePort.close(handle);
      if (enabled && file) await writeFile(path, 'abc');
    },
  });
  let value = record(); value = advance(value, await finish(files.store.prepare(value, context()))); enabled = true;
  await expect(finish(files.store.append({ record: value, offset: 0, bytes: Buffer.from('abc') }, context()))).rejects.toMatchObject({ code: 'integrity' });
  expect(await readFile(files.path(value))).toEqual(Buffer.from('abc'));
});
it('refuses unexplained extra publication links without unlinking either deterministic name', async () => {
  files = await fixture(); let value = await populated(files); const extra = `${files.path(value)}-extra`; await link(files.path(value), extra);
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  await expect(finish(files.store.publish(value, context()))).rejects.toMatchObject({ code: 'integrity' });
  expect((await lstat(extra)).nlink).toBe(2); expect((await lstat(files.path(value))).nlink).toBe(2);
});
