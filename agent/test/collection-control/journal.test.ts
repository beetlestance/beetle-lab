import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import type { Offer } from '@beetle/contracts';
import { openJournal } from '../../src/journal/index.js';
import { fixture, value } from './fixture.js';

describe('public journal checkpoint integration', () => {
  const f = fixture();
  it('commits, replays the same pending request once, accepts, and restores from durable checkpoint', async () => {
    const outDir = join(f.directory(), 'worker');
    await build({ entry: ['agent/src/journal/worker.ts'], outDir, format: ['esm'], platform: 'node', target: 'node24',
      bundle: true, noExternal: [/.*/], shims: true, removeNodeProtocol: false, splitting: false, silent: true });
    const options = { path: join(f.directory(), 'checkpoint.sqlite'), workerUrl: pathToFileURL(join(outDir, 'worker.js')) };
    let journal = await openJournal(options);
    try {
      const offer = JSON.parse(await readFile('contracts/fixtures/valid/offer.json', 'utf8')) as Offer;
      await journal.immutableOffer(offer);
      await f.write(`${JSON.stringify(f.event())}\n`); const reader = f.reader(); const batch = await value(reader);
      if (batch.kind !== 'batch') throw new Error('expected batch');
      const checkpoint = await journal.commitWrapperBatch(batch.request);
      await journal.close(); journal = await openJournal(options);
      expect(await journal.commitWrapperBatch(batch.request)).toEqual(checkpoint);
      reader.accept(checkpoint); expect(await journal.readWrapperCheckpoint(f.key())).toEqual(checkpoint);
      expect((await journal.readEvents(f.key(), 0)).events).toHaveLength(1);
      await reader.close(); const restored = f.reader(checkpoint);
      expect(await value(restored)).toMatchObject({ kind: 'verifying', phase: 'restart', verifiedBytes: checkpoint.offset });
      expect(await value(restored, true)).toMatchObject({ consistency: 'stopped_verified', cursor: checkpoint });
    } finally { await journal.close(); }
  }, 20_000);
});
