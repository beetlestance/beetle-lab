import {afterEach, expect, it} from 'vitest';
import {mkdtemp, writeFile, link, symlink, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {deliveryDigest, readDeliveryJson} from './files.js';

const roots: string[] = [];
afterEach(async () => {await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'beetle-delivery-files-')); roots.push(root);
  const file = join(root, 'metadata.json'); await writeFile(file, '{}', {mode: 0o600}); return {root, file};
}
it('reads bounded JSON and hashes exact bytes through the fixed archive window', async () => {
  const f = await fixture(); expect(await readDeliveryJson(f.file)).toEqual({});
  expect(await deliveryDigest(f.file, 2)).toEqual({bytes: 2, sha256: createHash('sha256').update('{}').digest('hex')});
  await expect(deliveryDigest(f.file, 1)).rejects.toThrow('size bound');
});
it('refuses oversized metadata without parsing a partial prefix', async () => {
  const f = await fixture(); await writeFile(f.file, ' '.repeat(262145));
  await expect(readDeliveryJson(f.file)).rejects.toThrow('metadata bound');
});
it('refuses symbolic or multiply linked metadata/archive leaves', async () => {
  const f = await fixture(); const alias = join(f.root, 'alias'); await symlink(f.file, alias);
  await expect(readDeliveryJson(alias)).rejects.toThrow(); await expect(deliveryDigest(alias, 2)).rejects.toThrow();
  await rm(alias); await link(f.file, alias);
  await expect(readDeliveryJson(f.file)).rejects.toThrow('metadata bound');
  await expect(deliveryDigest(f.file, 2)).rejects.toThrow('size bound');
});
it('refuses a FIFO without waiting for a writer', async () => {
  const f = await fixture(); const fifo = join(f.root, 'pipe'); execFileSync('mkfifo', [fifo], {timeout: 1000});
  await expect(readDeliveryJson(fifo)).rejects.toThrow('metadata bound');
  await expect(deliveryDigest(fifo, 1024)).rejects.toThrow('size bound');
});
