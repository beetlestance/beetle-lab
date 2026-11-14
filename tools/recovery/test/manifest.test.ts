import { rm, writeFile, appendFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import header from '../../../contracts/fixtures/valid/recovery-header.json' with {type: 'json'};
import { RecoveryIO } from '../src/io.js';
import { readManifest } from '../src/manifest.js';
import { verifyArchive } from '../src/archive.js';
import { archiveFixture as fixture } from './archive-fixture.js';
function io() {return new RecoveryIO({signal: new AbortController().signal, deadline: performance.now() + 10000});}
it('streams and seals a complete bounded archive and independently verifies every copied file', async () => {
  const f = await fixture(); const owner = io();
  try {expect(await verifyArchive(owner, f.destination, f.bounds)).toMatchObject({sha256: f.result.sha256, files: 4});}
  finally {await owner.closeAll();}
});
it('rejects truncated or appended manifests at actual EOF without treating a prefix as complete', async () => {
  const f = await fixture(); const original = await readFile(f.manifestPath); const owner = io();
  try {
    await writeFile(f.manifestPath, original.subarray(0, -1)); await expect(readManifest(owner, f.manifestPath)).rejects.toThrow();
    await writeFile(f.manifestPath, original); await appendFile(f.manifestPath, '{}\n'); await expect(readManifest(owner, f.manifestPath)).rejects.toThrow();
  } finally {await owner.closeAll();}
});
it('refuses payload corruption, unlisted files and symlink substitutions', async () => {
  const f = await fixture(); const owner = io();
  try {
    const extra = join(f.destination, 'foreign'); await writeFile(extra, '', {mode: 0o600});
    await expect(verifyArchive(owner, f.destination, f.bounds)).rejects.toThrow(); await rm(extra);
    const payload = join(f.destination, header.roles.metadata); await writeFile(payload, 'corrupt', {mode: 0o600});
    await expect(verifyArchive(owner, f.destination, f.bounds)).rejects.toThrow();
    await rm(payload); await symlink(join(f.source, 'item'), payload);
    await expect(verifyArchive(owner, f.destination, f.bounds)).rejects.toThrow();
  } finally {await owner.closeAll();}
});
it('rejects byte and entry budgets before accepting a complete archive', async () => {
  const f = await fixture(); const owner = io();
  try {
    await expect(verifyArchive(owner, f.destination, {...f.bounds, maximumBytes: 1})).rejects.toThrow('limit');
    await expect(verifyArchive(owner, f.destination, {...f.bounds, maximumEntries: 1})).rejects.toThrow('limit');
  } finally {await owner.closeAll();}
});
