import { afterEach, expect, it } from 'vitest';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture, createFolder, seed } from '../../storage/fixture.js';
import { createSuite, append as appendRevision, request as revisionRequest } from '../../storage/suites-fixture.js';
import { setup, create, publish, base, scope, requestId, uuid, digest } from './fixture.js';
import type { App } from './fixture.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const open = async () => { const app = await setup(fixture); apps.push(app); return app; };

it('pairs and creates/uploads/retries/seals/reads/ranges/deletes actual native bytes and SQLite metadata', async () => {
  const app = await open(); const content = 'hello π'; const { record, payload } = await create(app, content);
  const url = `${base}/${record.id}`;
  expect(record).toMatchObject({ state: 'staging', offset: 0, version: 1, bytes: Buffer.byteLength(content) });
  const replay = await app.server.inject({ method: 'POST', url: base, headers: app.headers, payload });
  expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(record);
  const append = () => app.server.inject({ method: 'PUT', url: `${url}/chunks?offset=0`,
    headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from(content) });
  const uploaded = await append(); expect(uploaded.statusCode).toBe(200);
  const current = uploaded.json<InputRecord>(); expect(current).toMatchObject({ offset: Buffer.byteLength(content), version: 2 });
  expect((await append()).json()).toEqual(current);
  const sealBody = { scope, requestId: requestId(), expectedVersion: current.version };
  const seal = await app.server.inject({ method: 'POST', url: `${url}/seal`, headers: app.headers, payload: sealBody });
  expect(seal.statusCode).toBe(202); expect(seal.json()).toMatchObject({ operation: 'seal', requestId: sealBody.requestId });
  expect((await app.server.inject({ method: 'POST', url: `${url}/seal`, headers: app.headers, payload: sealBody })).json()).toEqual(seal.json());
  const status = await app.server.inject({ url, headers: app.headers }); expect(status.json().state).toBe('published');
  const list = await app.server.inject({ url: `${base}?limit=100`, headers: app.headers });
  expect(list.statusCode).toBe(200); expect(list.json()).toMatchObject({ scope, items: [{ id: record.id }] });
  const full = await app.server.inject({ url: `${url}/content`, headers: app.headers });
  expect(full.statusCode).toBe(200); expect(full.rawPayload).toEqual(Buffer.from(content));
  expect(full.headers).toMatchObject({ 'transfer-encoding': 'chunked', etag: `"${digest(content)}"`,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' });
  expect(full.headers).not.toHaveProperty('content-length');
  for (const [range, result] of [['bytes=1-3', 'ell'], ['bytes=6-', 'π'], ['bytes=-2', 'π']]) {
    const response = await app.server.inject({ url: `${url}/content`, headers: { ...app.headers, range } });
    expect(response.statusCode).toBe(206); expect(response.body).toBe(result);
  }
  const ignored = await app.server.inject({ url: `${url}/content`, headers: { ...app.headers, range: 'bytes=1-2', 'if-range': 'W/"wrong"' } });
  expect(ignored.statusCode).toBe(200); expect(ignored.body).toBe(content);
  const accepted = await app.server.inject({ method: 'DELETE', url, headers: app.headers,
    payload: { scope, requestId: requestId(), expectedVersion: status.json().version } });
  expect(accepted.statusCode).toBe(202); expect((await app.server.inject({ url, headers: app.headers })).json().state).toBe('deleted');
  expect((await app.server.inject({ url: `${url}/content`, headers: app.headers })).statusCode).toBe(409);
});

it('publishes empty bytes and rejects invalid/unsatisfiable ranges with fixed 416 bodies', async () => {
  const app = await open(); const empty = await publish(app, ''); const record = await publish(app, 'abc');
  const response = await app.server.inject({ url: `${base}/${empty.id}/content`, headers: app.headers });
  expect(response.statusCode).toBe(200); expect(response.headers['content-length']).toBe('0'); expect(response.body).toBe('');
  for (const range of ['bytes=3-', 'bytes=-0', 'bytes=2-1', 'bytes=0-1,2-3', 'items=0-1', 'bytes=-']) {
    const result = await app.server.inject({ url: `${base}/${record.id}/content`, headers: { ...app.headers, range } });
    expect(result.statusCode).toBe(416); expect(result.headers['content-range']).toBe('bytes */3');
    expect(result.json()).toMatchObject({ code: 'invalid_value', message: 'Invalid value', fields: [] });
  }
  const clamped = await app.server.inject({ url: `${base}/${record.id}/content`, headers: { ...app.headers, range: 'bytes=1-999' } });
  expect(clamped.statusCode).toBe(206); expect(clamped.headers['content-range']).toBe('bytes 1-2/3'); expect(clamped.body).toBe('bc');
  for (const range of [`bytes=0-${'9'.repeat(128)}`, `bytes=-${'9'.repeat(128)}`]) {
    const huge = await app.server.inject({ url: `${base}/${record.id}/content`, headers: { ...app.headers, range } });
    expect(huge.statusCode).toBe(206); expect(huge.headers['content-range']).toBe('bytes 0-2/3'); expect(huge.body).toBe('abc');
  }
  expect((await app.server.inject({ method: 'HEAD', url: `${base}/${record.id}/content`, headers: app.headers })).statusCode).toBe(404);
});

it('enforces real scope/folder/version constraints and private page scope', async () => {
  const app = await open(); await seed(app.metadata, 11, 12, 13); await createFolder(app.metadata, 14, uuid(13),
    { ...scope, organizationId: uuid(11), workspaceId: uuid(12) });
  const { record, payload } = await create(app, 'abc');
  const wrongFolder = await app.server.inject({ method: 'POST', url: base, headers: app.headers,
    payload: { ...payload, requestId: requestId(), folderId: uuid(14) } });
  expect(wrongFolder.statusCode).toBe(404);
  const wrongScope = await app.server.inject({ method: 'POST', url: base, headers: app.headers,
    payload: { ...payload, scope: { ...scope, workspaceId: uuid(12) } } });
  expect(wrongScope.statusCode).toBe(404);
  const wrongOrg = base.replace(scope.organizationId, uuid(11));
  expect((await app.server.inject({ url: `${wrongOrg}/${record.id}`, headers: app.headers })).statusCode).toBe(404);
  expect((await app.server.inject({ method: 'DELETE', url: `${base}/${record.id}`, headers: app.headers,
    payload: { scope, requestId: requestId(), expectedVersion: 9 } })).statusCode).toBe(409);
});

it('protects real retained revision pins and fences a changed-byte retry', async () => {
  const app = await open(); const record = await publish(app, '[]');
  const suite = await createSuite(app.metadata); const body = revisionRequest();
  body.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu',
    input: { id: record.id, sha256: record.sha256, bytes: record.bytes } }];
  await appendRevision(app.metadata, suite, 60, body);
  const removed = await app.server.inject({ method: 'DELETE', url: `${base}/${record.id}`, headers: app.headers,
    payload: { scope, requestId: requestId(), expectedVersion: record.version } });
  expect(removed.statusCode).toBe(409); expect(removed.json().code).toBe('conflict');
  const staged = await create(app, 'abc');
  const upload = (payload: string) => app.server.inject({ method: 'PUT', url: `${base}/${staged.record.id}/chunks?offset=0`,
    headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload });
  expect((await upload('abc')).statusCode).toBe(200);
  expect((await upload('xyz')).statusCode).toBe(503);
  expect(await app.service.get({ scope, id: staged.record.id })).toMatchObject({ state: 'failed', reason: 'integrity' });
});
