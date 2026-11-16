import { executionArtifacts } from '@beetle/contracts';
import { expect, it } from 'vitest';
import { runArtifactContentPath, createApiClient } from '@beetle/contracts/api';
import { published } from './fixture.js';
import { httpFixture } from './http-fixture.js';
import { storageFixture, scope, uuid } from '../storage/fixture.js';
const storage = storageFixture();
it('streams actual scoped full/range/empty native files over authorized TCP through compiled metadata and keeps charges/ACK unchanged after reopen', async () => {
  const contents = [Buffer.from('synthetic artifact'), Buffer.alloc(0)]; const f = await published(contents);
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  let metadata = await storage.open(path); const http = await httpFixture(metadata.runArtifacts, f.files.store);
  const params = {organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId: f.key.runId,
    attemptId: f.key.attempt.attemptId};
  const content = runArtifactContentPath({...params, artifactId: executionArtifacts(f.envelope.manifest.result)[0]!.artifactId});
  const listPath = `/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/attempts/${params.attemptId}/artifacts`;
  try {
    const charges = await metadata.inputs.storage(); const cursor = await metadata.runEvents.getRunEvents({id: params.runId, scope, limit: 100});
    expect((await fetch(http.origin + content)).status).toBe(401);
    expect((await http.request(content, {origin: 'http://127.0.0.1:1'})).status).toBe(403);
    const api = createApiClient({baseUrl: http.origin, fetch: (url, init) => fetch(url, {...init, headers: http.headers})});
    expect(await api.listRunArtifacts({params, query: {limit: 1}})).toMatchObject({ok: true, value: {availability: 'ready', items: [executionArtifacts(f.envelope.manifest.result)[0]]}});
    expect((await http.request(listPath + '?limit=101')).status).toBe(400);
    expect((await http.request(content.replace(params.attemptId, uuid(999)))).status).toBe(404);
    expect((await http.request(content.replace(params.workspaceId, uuid(999)))).status).toBe(404);
    const full = await http.request(content); expect(full.status).toBe(200); expect(full.headers.get('content-length')).toBeNull();
    expect(full.headers.get('transfer-encoding')).toBe('chunked'); expect(Buffer.from(await full.arrayBuffer())).toEqual(contents[0]);
    const range = await http.request(content, {range: 'bytes=2-6'}); expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(contents[0]!.subarray(2, 7));
    expect((await http.request(content, {range: 'bytes=999-'})).status).toBe(416);
    const fallback = await http.request(content, {range: 'bytes=2-6', 'if-range': '"other"'});
    expect(fallback.status).toBe(200); await fallback.arrayBuffer();
    const empty = await http.request(runArtifactContentPath({...params, artifactId: executionArtifacts(f.envelope.manifest.result)[1]!.artifactId}));
    expect(empty.status).toBe(200); expect((await empty.arrayBuffer()).byteLength).toBe(0);
    expect(await metadata.inputs.storage()).toEqual(charges); expect(await metadata.runEvents.getRunEvents({id: params.runId, scope, limit: 100})).toEqual(cursor);
    await http.close(); await storage.close(metadata); metadata = await storage.open(path);
    expect(await metadata.runArtifacts.listRunArtifacts({id: params.runId, attemptId: params.attemptId, scope, limit: 100})).toMatchObject({availability: 'ready', items: executionArtifacts(f.envelope.manifest.result)});
    expect(await metadata.inputs.storage()).toEqual(charges);
  } finally {await http.close(); await storage.close(metadata); await f.files.dispose();}
});
