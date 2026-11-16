import { afterEach, expect, it, vi } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import type { InputPage, InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture } from '../../storage/fixture.js';
import { setup, create, wrap, base } from './fixture.js';
import type { App } from './fixture.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

it('rejects Buffer and accessor service replies before schema access or Fastify serializer bypass', async () => {
  let result: InputRecord | undefined;
  const app = await setup(fixture, service => wrap(service, {
    append: async () => result!, get: async key => result ?? service.get(key),
  })); apps.push(app);
  const { record } = await create(app, 'a'); const getter = vi.fn(() => 'PRIVATE_CANARY');
  const withAccessor = { ...record }; Object.defineProperty(withAccessor, 'name', { get: getter, enumerable: true });
  const buffer = Object.defineProperties(Buffer.alloc(0), Object.getOwnPropertyDescriptors(record)) as unknown as InputRecord;
  // Hide inherited enumerable Buffer methods so AJV sees exactly the record fields.
  for (const key in buffer) {
    if (!Object.hasOwn(buffer, key)) Object.defineProperty(buffer, key, { value: undefined, enumerable: false });
  }
  expect(Buffer.isBuffer(buffer)).toBe(true); expect(validateApi('InputRecord', buffer).ok).toBe(true);
  for (const malformed of [buffer, withAccessor]) {
    result = malformed;
    const json = await app.server.inject({ url: `${base}/${record.id}`, headers: app.headers });
    expect(json.statusCode).toBe(500); expect(json.json().code).toBe('internal_error');
    const upload = await app.server.inject({ method: 'PUT', url: `${base}/${record.id}/chunks?offset=0`,
      headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload: 'a' });
    expect(upload.statusCode).toBe(500); expect(upload.json().code).toBe('internal_error');
    const content = await app.server.inject({ url: `${base}/${record.id}/content`, headers: app.headers });
    expect(content.statusCode).toBe(500);
    for (const response of [json, upload, content]) expect(response.body).not.toContain('PRIVATE_CANARY');
  }
  expect(getter).not.toHaveBeenCalled();
});

it('snapshots a private page before adding route scope without executing an accessor', async () => {
  const getter = vi.fn(() => 'PRIVATE_PAGE_CANARY');
  const page = Object.defineProperty({ nextCursor: null }, 'items', { get: getter, enumerable: true }) as InputPage;
  const app = await setup(fixture, service => wrap(service, { list: async () => page })); apps.push(app);
  const response = await app.server.inject({ url: `${base}?limit=100`, headers: app.headers });
  expect(response.statusCode).toBe(500); expect(response.json().code).toBe('internal_error');
  expect(response.body).not.toContain('PRIVATE_PAGE_CANARY'); expect(getter).not.toHaveBeenCalled();
});
