import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
const f = runFixture();
it('saves About metadata atomically over HTTP and returns a precise collision without rewriting replayed metadata', async () => {
 const running = await f.open(undefined, {}, true);
 const connection = await client(running.app, false, running.origin);
 const saved = await savedSuite(connection.api);
 const params = { ...saved.params, suiteId: saved.pinned.suiteId };
 const workspace = value(await connection.api.getWorkspace({ params: saved.params }));
 const folder = value(await connection.api.createFolder({ params: saved.params, body: {
  scope: saved.scope, requestId: randomUUID(), name: 'Destination', parentFolderId: workspace.rootFolderId,
 } }));
 value(await connection.api.createSuite({ params: saved.params, body: { scope: saved.scope, requestId: randomUUID(), name: 'Occupied', folderId: folder.id } }));
 const body = { scope: saved.scope, requestId: randomUUID(), expectedVersion: 2, engineId: 'k6' as const, configVersion: 1 as const,
  config: saved.pinned.config, metadata: { name: 'Renamed', folderId: folder.id, description: 'Saved with config' } };
 const revision = value(await connection.api.createSuiteRevision({ params, body }));
 expect(revision.digest).toBe(saved.pinned.digest);
 const suite = value(await connection.api.getSuite({ params }));
 expect(suite).toMatchObject({ version: 3, name: 'Renamed', folderId: folder.id, description: 'Saved with config', currentRevisionId: revision.id });
 const collision = await connection.api.createSuiteRevision({ params, body: { ...body, requestId: randomUUID(), expectedVersion: 3, metadata: { name: 'OCCUPIED' } } });
 expect(collision).toMatchObject({ ok: false, error: { protocol: { code: 'conflict', fields: [{ path: '/metadata/name', code: 'conflict' }] } } });
 expect(value(await connection.api.getSuite({ params }))).toEqual(suite);
 expect(value(await connection.api.listSuiteRevisions({ params, query: { limit: 10 } })).items).toHaveLength(2);
 value(await connection.api.patchSuite({ params, body: { scope: saved.scope, requestId: randomUUID(), expectedVersion: 3, name: 'Later' } }));
 expect(value(await connection.api.createSuiteRevision({ params, body }))).toEqual(revision);
 expect(value(await connection.api.getSuite({ params }))).toMatchObject({ name: 'Later', version: 4, currentRevisionId: revision.id });
});
