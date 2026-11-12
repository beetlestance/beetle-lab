import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, chmod, symlink, link, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareCredentialDestination, readFileBounded, writeCredentials } from '../../../src/client/cli/files.js';
let root: string;
beforeEach(async () => {root = await mkdtemp(join(tmpdir(), 'beetle-client-files-'));});
afterEach(async () => {await rm(root, {recursive: true, force: true});});
it('writes and syncs one exclusive private credential file without replacing it', async () => {
  const path = join(root, 'session'); await prepareCredentialDestination(path); await writeCredentials(path, '{"synthetic":true}\n');
  expect((await stat(path)).mode & 0o777).toBe(0o600); expect(await readFileBounded(path, 4096, true)).toBe('{"synthetic":true}\n');
  await expect(prepareCredentialDestination(path)).rejects.toThrow('io'); await expect(writeCredentials(path, 'replacement')).rejects.toThrow('io');
  expect(await readFile(path, 'utf8')).toBe('{"synthetic":true}\n');
});
it('rejects oversized, malformed UTF8, directory, symlink and multiply-linked reads', async () => {
  const path = join(root, 'input'); await writeFile(path, 'x'.repeat(4097), {mode: 0o600});
  await expect(readFileBounded(path, 4096)).rejects.toThrow('io'); await writeFile(path, Buffer.from([0xff]));
  await expect(readFileBounded(path, 4096)).rejects.toThrow('io'); await expect(readFileBounded(root, 4096)).rejects.toThrow('io');
  await writeFile(path, 'valid'); const alias = join(root, 'alias'); await symlink(path, alias);
  await expect(readFileBounded(alias, 4096)).rejects.toThrow('io'); await rm(alias); await link(path, alias);
  await expect(readFileBounded(path, 4096)).rejects.toThrow('io');
});
it('requires exact private mode for secrets and private output directories', async () => {
  const path = join(root, 'token'); await writeFile(path, 'synthetic', {mode: 0o644}); await chmod(path, 0o644);
  await expect(readFileBounded(path, 64, true)).rejects.toThrow('io');
  const publicDir = join(root, 'public'); await mkdir(publicDir, {mode: 0o755}); await chmod(publicDir, 0o755);
  await expect(writeCredentials(join(publicDir, 'session'), 'secret')).rejects.toThrow('io');
  const alias = join(root, 'directory-alias'); await symlink(root, alias);
  await expect(writeCredentials(join(alias, 'session'), 'secret')).rejects.toThrow('io');
});
