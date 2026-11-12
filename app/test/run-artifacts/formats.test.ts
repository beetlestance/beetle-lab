import { expect, it } from 'vitest';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { published } from './fixture.js';
import { httpFixture } from './http-fixture.js';
import { storageFixture, scope } from '../storage/fixture.js';
const storage = storageFixture();
it('serves verified text/CSV/JSON with fixed safe attachment names over authenticated full/range reads', async () => {
  const kinds = ['performance-report', 'metrics-csv', 'numeric-final', 'raw'];
  const extensions = ['txt', 'csv', 'json', 'bin']; const types = ['text/plain', 'text/csv', 'application/json', 'application/octet-stream'];
  const contents = kinds.map(kind => Buffer.from(`synthetic ${kind}\n`)); const f = await published(contents, kinds);
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path); const metadata = await storage.open(path);
  const http = await httpFixture(metadata.runArtifacts, f.files.store);
  try {
    const charges = await metadata.inputs.storage();
    for (const [ordinal, artifact] of f.envelope.manifest.result.artifacts.entries()) {
      const route = runArtifactContentPath({organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        runId: f.key.runId, attemptId: f.key.attempt.attemptId, artifactId: artifact.artifactId});
      for (const range of [false, true]) {
        const response = await http.request(route, range ? {range: 'bytes=0-3'} : {});
        expect(response.status).toBe(range ? 206 : 200);
        expect(response.headers.get('content-type')).toContain(types[ordinal]);
        expect(response.headers.get('content-disposition')).toBe(`attachment; filename="artifact-${artifact.artifactId}.${extensions[ordinal]}"`);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff'); expect(response.headers.get('cache-control')).toBe('no-store');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(range ? contents[ordinal]!.subarray(0, 4) : contents[ordinal]);
      }
    }
    expect(await metadata.inputs.storage()).toEqual(charges);
  } finally {await http.close(); await storage.close(metadata); await f.files.dispose();}
});
