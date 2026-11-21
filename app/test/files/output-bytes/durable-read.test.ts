import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import type { OutputFileRecord } from '../../../src/ports/output-bytes.js';
import { advance, context, finish, fixture, populated } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
async function publish(bytes: Buffer<ArrayBuffer>): Promise<OutputFileRecord> {
  let value = await populated(files, bytes);
  value = { ...value, artifact: { ...value.artifact, phase: 'publishing' } };
  return advance(value, await finish(files.store.publish(value, context())), 'published');
}
/** Same bytes under a new inode, as after a VirtioFS restart or a restored copy. */
async function replace(value: OutputFileRecord, bytes: Buffer, mode = 0o600): Promise<void> {
  const path = files.path(value, true); const next = `${path}.next`;
  await writeFile(next, bytes, { mode }); await chmod(next, mode); await rename(next, path);
}
async function read(value: OutputFileRecord): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await finish(files.store.read({ record: value, start: 0, endExclusive: value.artifact.bytes, sink: { write: async chunk => { chunks.push(Buffer.from(chunk)); } } }, context()));
  return Buffer.concat(chunks);
}

it('reads a published output whose inode moved once size, owner, mode, one link and SHA-256 hold', async () => {
  files = await fixture(); const bytes = Buffer.from('recorded metrics');
  const value = await publish(bytes);
  await replace(value, await readFile(files.path(value, true)));
  expect(await read(value)).toEqual(bytes);
  expect(await read(value)).toEqual(bytes);
  await files.reopen(); expect(await read(value)).toEqual(bytes);
});

it('refuses a moved published output with other bytes or a wider mode', async () => {
  files = await fixture(); const value = await publish(Buffer.from('recorded metrics'));
  await replace(value, Buffer.from('tampered metrics'));
  await expect(read(value)).rejects.toMatchObject({ code: 'integrity' });
  await replace(value, Buffer.from('recorded metrics'), 0o644);
  await expect(read(value)).rejects.toMatchObject({ code: 'integrity' });
  await replace(value, Buffer.from('recorded metric'));
  await expect(read(value)).rejects.toMatchObject({ code: 'integrity' });
});
