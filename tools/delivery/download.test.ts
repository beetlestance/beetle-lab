import {mkdtemp, writeFile, rm, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {verifyArtifactArchive} from './download.js';
import {maximumArtifactZipBytes} from './identity.js';
import {archiveProducer} from './producer.js';

it('checks exact artifact ZIP bytes, not a matching filename or inner archive hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-artifact-digest-'));
  try {
    const path = join(directory, 'artifact.zip'); const payload = Buffer.from('synthetic ZIP bytes');
    await writeFile(path, payload);
    const artifact = {id: 1, name: 'synthetic', bytes: payload.length,
      artifactDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`};
    await expect(verifyArtifactArchive(artifact, path)).resolves.toBeUndefined();
    await expect(verifyArtifactArchive({...artifact, bytes: payload.length + 1}, path)).rejects.toThrow('mismatch');
    await expect(verifyArtifactArchive({...artifact, artifactDigest: `sha256:${'a'.repeat(64)}`}, path)).rejects.toThrow('mismatch');
    await writeFile(path, Buffer.concat([payload, Buffer.from('extra')]));
    await expect(verifyArtifactArchive(artifact, path)).rejects.toThrow('size bound');
    const alias = join(directory, 'alias.zip'); await symlink(path, alias);
    await expect(verifyArtifactArchive(artifact, alias)).rejects.toThrow();
  } finally {await rm(directory, {recursive: true});}
});
it('uses the same finite ZIP transport ceiling through download validation and the producer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-artifact-bound-'));
  try {
    const path = join(directory, 'synthetic.zip');
    await expect(archiveProducer({executable: process.execPath, args: ['-e', 'process.stdout.write("x")'],
      destination: path, maximumBytes: maximumArtifactZipBytes})).resolves.toBe(1);
    const artifact = {id: 1, name: 'synthetic', bytes: maximumArtifactZipBytes, artifactDigest: `sha256:${'a'.repeat(64)}`};
    await expect(verifyArtifactArchive(artifact, path)).rejects.toThrow('mismatch');
    await expect(verifyArtifactArchive({...artifact, bytes: maximumArtifactZipBytes + 1}, path)).rejects.toThrow('Invalid immutable');
    await expect(archiveProducer({executable: process.execPath, args: ['-e', ''],
      destination: join(directory, 'rejected.zip'), maximumBytes: maximumArtifactZipBytes + 1})).rejects.toThrow('producer bound');
  } finally {await rm(directory, {recursive: true});}
});
