import { appendFile, link, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, finish, fixture, populated, record } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
it('appends/replays bounded binary chunks, publishes, reads with backpressure and reconciles the exact published signature', async () => {
  files = await fixture(); const bytes = Buffer.alloc(131_089); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + 19) % 256;
  let value = record(bytes); const prepared = await finish(files.store.prepare(value, context()));
  value = advance(value, prepared); expect(prepared.offset).toBe(0);
  const immutable = value; const first = { record: value, offset: 0, bytes: bytes.subarray(0, 65_536) };
  const written = await finish(files.store.append(first, context()));
  expect(await finish(files.store.append(first, context()))).toEqual(written);
  value = advance(value, written);
  for (const end of [131_072, 131_089]) {
    const next = await finish(files.store.append({ record: value, offset: value.artifact.offset, bytes: bytes.subarray(value.artifact.offset, end) }, context()));
    expect(next.identity).toBe(prepared.identity); value = advance(value, next);
  }
  expect(immutable.artifact.offset).toBe(0); expect(await readFile(files.path(value))).toEqual(bytes);
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  const published = await finish(files.store.publish(value, context())); expect(published.identity).not.toBe(prepared.identity);
  value = advance(value, published, 'published'); expect((await lstat(files.path(value, true))).nlink).toBe(1);
  await expect(lstat(files.path(value))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await finish(files.store.prepare(value, context()))).toEqual(published);
  const chunks: Buffer[] = [];
  await finish(files.store.read({ record: value, start: 0, endExclusive: bytes.length, sink: { write: async chunk => { chunks.push(Buffer.from(chunk)); } } }, context()));
  expect(chunks.map(chunk => chunk.length)).toEqual([65_536, 65_536, 17]); expect(Buffer.concat(chunks)).toEqual(bytes);
  await files.reopen(); expect(await finish(files.store.prepare(value, context()))).toEqual(published);
});
it('compares an interrupted native tail, writes only its suffix and never truncates', async () => {
  let failOnce = true; let truncates = 0; const writes: number[] = [];
  files = await fixture({ ...nativePort, truncate: async (...args) => { truncates++; await nativePort.truncate(...args); },
    write: async (handle, bytes, offset) => {
      writes.push(bytes.length);
      if (failOnce) { failOnce = false; await nativePort.write(handle, bytes.subarray(0, 2), offset); throw new Error('Synthetic lost partial write'); }
      return nativePort.write(handle, bytes, offset);
    } });
  let value = record(Buffer.from('abcde')); value = advance(value, await finish(files.store.prepare(value, context())));
  const request = { record: value, offset: 0, bytes: Buffer.from('abcde') };
  await expect(finish(files.store.append(request, context()))).rejects.toMatchObject({ code: 'io' });
  expect(await readFile(files.path(value))).toEqual(Buffer.from('ab'));
  const recovered = await finish(files.store.append(request, context())); expect(recovered.offset).toBe(5);
  expect(writes).toEqual([5, 3]); expect(truncates).toBe(0); expect(await readFile(files.path(value))).toEqual(Buffer.from('abcde'));
});
it('rejects conflicting overlap, gaps and extents beyond the manifest without rewriting the tail', async () => {
  files = await fixture(); let value = record(Buffer.from('abcde')); value = advance(value, await finish(files.store.prepare(value, context())));
  await appendFile(files.path(value), 'ab');
  await expect(finish(files.store.append({ record: value, offset: 0, bytes: Buffer.from('axc') }, context()))).rejects.toMatchObject({ code: 'integrity' });
  await expect(finish(files.store.append({ record: value, offset: 1, bytes: Buffer.from('bc') }, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(finish(files.store.append({ record: value, offset: 0, bytes: Buffer.from('abcdef') }, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await readFile(files.path(value))).toEqual(Buffer.from('ab'));
  const recovered = await finish(files.store.prepare(value, context())); expect(recovered.offset).toBe(2); expect(recovered.identity).toBe(value.artifact.identity);
});
it('publishes checked empty custody and never reconstructs a missing known inode', async () => {
  files = await fixture(); let value = record(Buffer.alloc(0)); value = advance(value, await finish(files.store.prepare(value, context())));
  await unlink(files.path(value)); await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'custody_missing' });
  value = record(Buffer.alloc(0), 9); value = advance(value, await finish(files.store.prepare(value, context())));
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  const receipt = await finish(files.store.publish(value, context())); value = advance(value, receipt, 'published');
  let calls = 0; await finish(files.store.read({ record: value, start: 0, endExclusive: 0, sink: { write: async () => { calls++; } } }, context()));
  expect(calls).toBe(0); expect(await readFile(files.path(value, true))).toEqual(Buffer.alloc(0));
});
it.each(['link', 'unlink'] as const)('recovers lost native publication %s replies under the same token and inode', async phase => {
  let failed = false;
  files = await fixture({ ...nativePort,
    link: async (...args) => { await nativePort.link(...args); if (phase === 'link' && !failed) { failed = true; throw new Error('Synthetic lost link reply'); } },
    unlink: async path => { await nativePort.unlink(path); if (phase === 'unlink' && !failed) { failed = true; throw new Error('Synthetic lost unlink reply'); } },
  });
  let value = await populated(files); const original = await lstat(files.path(value), { bigint: true });
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  await expect(finish(files.store.publish(value, context()))).rejects.toMatchObject({ code: 'io' }); expect(failed).toBe(true);
  await files.reopen(); const receipt = await finish(files.store.publish(value, context())); expect(receipt.phase).toBe('published');
  expect((await lstat(files.path(value, true), { bigint: true })).ino).toBe(original.ino);
  value = advance(value, receipt, 'published'); await writeFile(files.path(value, true), Buffer.from('abc'));
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'integrity' });
  let calls = 0; await expect(finish(files.store.read({ record: value, start: 0, endExclusive: 3, sink: { write: async () => { calls++; } } }, context()))).rejects.toMatchObject({ code: 'integrity' });
  expect(calls).toBe(0);
});
it.each(['file', 'root', 'links', 'identity'] as const)('refuses changed %s custody without replacing it', async kind => {
  files = await fixture(); let value = await populated(files); const path = files.path(value);
  if (kind === 'file') { await rename(path, `${path}-original`); await writeFile(path, 'abc', { mode: 0o600 }); }
  if (kind === 'root') { await rename(files.options.stagingRoot, `${files.options.stagingRoot}-original`); await mkdir(files.options.stagingRoot, { mode: 0o700 }); }
  if (kind === 'links') await link(path, join(files.root, 'extra-link'));
  if (kind === 'identity') value = { ...value, artifact: { ...value.artifact, identity: 'f'.repeat(64) } };
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'integrity' });
});
it('does not adopt unknown nonempty payload or publish without full expected SHA', async () => {
  files = await fixture(); const value = record(); await finish(files.store.prepare(value, context())); await appendFile(files.path(value), 'abc');
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'integrity' });
  let known = await populated(files, Buffer.from('abc'), 9); await writeFile(files.path(known), 'xyz');
  known = { ...known, artifact: { ...known.artifact, phase: 'publishing' } };
  await expect(finish(files.store.publish(known, context()))).rejects.toMatchObject({ code: 'integrity' });
  await expect(lstat(files.path(known, true))).rejects.toMatchObject({ code: 'ENOENT' });
});
