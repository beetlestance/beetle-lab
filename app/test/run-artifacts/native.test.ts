import { expect, it } from 'vitest';
import { unlink } from 'node:fs/promises';
import { RunArtifacts } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import { captureRunArtifactCursor } from '@beetle/contracts/api';
import { published } from './fixture.js';
import { scope, uuid } from '../storage/fixture.js';
import { context, finish } from '../files/output-bytes/fixture.js';
import type { RunArtifactPage } from '@beetle/contracts/api';
import type { OutputFileRecord } from '../../src/ports/output-bytes.js';
it('lists exact native publication, pages canonical positions, reads ranges/empty and refuses missing custody without mutations', async () => {
  const contents = [Buffer.from('synthetic artifact'), Buffer.alloc(0), Buffer.from('third')];
  const f = await published(contents); const reader = new RunArtifacts(f.db, f.reads);
  const query = {id: f.key.runId, attemptId: f.key.attempt.attemptId, scope, limit: 1};
  try {
    const before = f.facts();
    const first = reader.execute({kind: 'listRunArtifacts', query}) as RunArtifactPage;
    expect(first.items).toEqual(f.envelope.manifest.result.artifacts.slice(0, 1));
    expect(captureRunArtifactCursor(first.nextCursor!).ordinal).toBe(1);
    const next = reader.execute({kind: 'listRunArtifacts', query: {...query, cursor: first.nextCursor!}}) as RunArtifactPage;
    expect(next.items).toEqual(f.envelope.manifest.result.artifacts.slice(1, 2));
    expect(() => reader.execute({kind: 'listRunArtifacts', query: {...query, id: uuid(999), cursor: first.nextCursor!}})).toThrow();
    expect(() => reader.execute({kind: 'listRunArtifacts', query: {...query, cursor: first.nextCursor! + '='}})).toThrow();
    for (const [ordinal, expected] of contents.entries()) {
      const record = reader.execute({kind: 'getRunArtifact', key: {id: query.id, scope, attemptId: query.attemptId, artifactId: f.envelope.manifest.result.artifacts[ordinal]!.artifactId}}) as OutputFileRecord;
      const chunks: Buffer[] = [];
      await finish(f.files.store.read({record, start: 0, endExclusive: expected.length, sink: {write: async bytes => {chunks.push(Buffer.from(bytes));}}}, context()));
      expect(Buffer.concat(chunks)).toEqual(expected);
      if (ordinal === 0) {
        await unlink(f.files.path(record, true));
        // Persisted publication remains metadata; native access independently refuses lost custody.
        expect(reader.execute({kind: 'listRunArtifacts', query})).toEqual(first);
        await expect(finish(f.files.store.read({record, start: 0, endExclusive: expected.length, sink: {write: async () => {}}}, context()))).rejects.toThrow();
      }
    }
    expect(f.facts()).toEqual(before);
  } finally {await f.files.dispose();}
});
