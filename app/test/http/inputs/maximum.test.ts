import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture } from '../../storage/fixture.js';
import { setup, base, scope, requestId } from './fixture.js';
import type { App } from './fixture.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

it('uploads 128 bounded chunks and reads the literal 8MiB maximum through actual HTTP/SQLite/native files', async () => {
  const app = await setup(fixture); apps.push(app);
  const expected = Buffer.alloc(8_388_608);
  for (let index = 0; index < expected.byteLength; index++) expected[index] = (index * 31 + 17) % 251;
  // Independent Python hashlib oracle for this literal periodic byte sequence.
  const sha256 = 'e469d5490c8b5362f3c96f409a25dced0e9848d9dd5fcae42efe3a86c3e14cab';
  expect(createHash('sha256').update(expected).digest('hex')).toBe(sha256);
  const created = await app.server.inject({ method: 'POST', url: base, headers: app.headers,
    payload: { scope, requestId: requestId(), name: 'Maximum synthetic input', bytes: 8_388_608, sha256 } });
  expect(created.statusCode).toBe(201); let record = created.json<InputRecord>();
  for (let chunk = 0; chunk < 128; chunk++) {
    const offset = chunk * 65_536;
    const appended = await app.server.inject({ method: 'PUT', url: `${base}/${record.id}/chunks?offset=${offset}`,
      headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload: expected.subarray(offset, offset + 65_536) });
    expect(appended.statusCode).toBe(200); record = appended.json<InputRecord>();
    expect(record).toMatchObject({ bytes: 8_388_608, offset: offset + 65_536, version: chunk + 2, sha256, state: 'staging' });
  }
  const url = `${base}/${record.id}`;
  const sealed = await app.server.inject({ method: 'POST', url: `${url}/seal`, headers: app.headers,
    payload: { scope, requestId: requestId(), expectedVersion: 129 } });
  expect(sealed.statusCode).toBe(202); expect(sealed.json().acceptedVersion).toBe(130);
  const status = await app.server.inject({ url, headers: app.headers });
  expect(status.statusCode).toBe(200); expect(status.json()).toMatchObject({ state: 'published', version: 131, bytes: 8_388_608, offset: 8_388_608, sha256 });
  const content = await app.server.inject({ url: `${url}/content`, headers: app.headers });
  expect(content.statusCode).toBe(200); expect(content.headers['content-length']).toBeUndefined();
  expect(content.headers['transfer-encoding']).toBe('chunked');
  expect(content.rawPayload.byteLength).toBe(8_388_608); expect(content.rawPayload.equals(expected)).toBe(true);
  expect(createHash('sha256').update(content.rawPayload).digest('hex')).toBe(sha256);
});
