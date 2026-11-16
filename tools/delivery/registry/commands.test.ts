import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, it} from 'vitest';
import {archiveProducer} from '../producer.js';
it('permits explicitly empty command logs while retaining nonempty payload and exit gates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-command-output-'));
  try {
    const command = {executable: process.execPath, args: ['-e', ''], maximumBytes: 64};
    await expect(archiveProducer({...command, destination: join(directory, 'payload')})).rejects.toMatchObject({kind: 'empty'});
    await expect(archiveProducer({...command, destination: join(directory, 'command'), allowEmptyOutput: true})).resolves.toBe(0);
    await expect(archiveProducer({...command, args: ['-e', 'process.exitCode=2'], destination: join(directory, 'failed'), allowEmptyOutput: true}))
      .rejects.toMatchObject({kind: 'exit'});
  } finally {await rm(directory, {recursive: true});}
});
