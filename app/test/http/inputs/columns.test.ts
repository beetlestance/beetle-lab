import { expect, it } from 'vitest';
import { createApiClient } from '@beetle/contracts/api';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import { storageFixture } from '../../storage/fixture.js';
import { base, deferred, host, origin, publish, scope, setup, turn, uuid, wrap } from './fixture.js';
const fixture = storageFixture();
it('discovers scoped names through authenticated verified filesystem reads and binds the explicit parser kind', async () => {
  const app = await setup(fixture);
  try {
    const record = await publish(app, 'currency,cartId\nINR,123\n');
    const client = createApiClient({
      baseUrl: origin,
      fetch: async (url) => {
        const parsed = new URL(String(url));
        const response = await app.server.inject({ url: parsed.pathname + parsed.search, headers: app.headers });
        expect(response.statusCode).toBe(200);
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': String(response.headers['content-type']) },
        });
      },
    });
    const result = await client.getInputColumns({
      params: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, inputId: record.id },
      query: { kind: 'csv' },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        scope,
        inputId: record.id,
        sha256: record.sha256,
        bytes: record.bytes,
        kind: 'csv',
        columns: ['currency', 'cartId'],
      },
    });
    const other = await app.server.inject({ url: `${base}/${record.id}/columns?kind=json`, headers: app.headers });
    expect(other.statusCode).toBe(200);
    expect(other.json().columns).toBeNull();
    expect(other.json().kind).toBe('json');
    expect((await app.service.get({ scope, id: record.id })).version).toBe(record.version);
  } finally {
    await app.close();
  }
});
it('returns sorted JSON columns and null for unsupported shape without exposing row values', async () => {
  const app = await setup(fixture);
  try {
    const record = await publish(app, '[{"term":"PRIVATE_SYNTHETIC_ROW","id":1},{"id":2,"term":"other"}]');
    const result = await app.server.inject({ url: `${base}/${record.id}/columns?kind=json`, headers: app.headers });
    expect(result.statusCode).toBe(200);
    expect(result.json().columns).toEqual(['id', 'term']);
    expect(result.body).not.toContain('PRIVATE_SYNTHETIC_ROW');
    const invalid = await publish(app, 'id,id\n1,2\n');
    const unknown = await app.server.inject({ url: `${base}/${invalid.id}/columns?kind=csv`, headers: app.headers });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().columns).toBeNull();
  } finally {
    await app.close();
  }
});
it('keeps closed query, session, host/origin and namespace guards on the new operation', async () => {
  const app = await setup(fixture);
  try {
    const record = await publish(app, 'id\n1\n');
    const url = `${base}/${record.id}/columns`;
    for (const query of ['', '?kind=yaml', '?kind=csv&extra=1', '?kind=csv&kind=json']) {
      const response = await app.server.inject({ url: url + query, headers: app.headers });
      expect(response.statusCode).toBe(400);
    }
    expect((await app.server.inject({ url: url + '?kind=csv', headers: { host, origin } })).statusCode).toBe(401);
    expect(
      (await app.server.inject({ url: url + '?kind=csv', headers: { ...app.headers, host: 'evil.invalid' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.server.inject({ url: url + '?kind=csv', headers: { ...app.headers, origin: 'http://evil.invalid' } }))
        .statusCode,
    ).toBe(403);
    const foreign = await app.server.inject({
      url: (url + '?kind=csv').replace(scope.workspaceId, uuid(900)),
      headers: app.headers,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain('columns');
  } finally {
    await app.close();
  }
});
it('does not release names after a late integrity error or a changed read identity', async () => {
  let changed = false;
  const app = await setup(fixture, (service) =>
    wrap(service, {
      read: async (key, range, sink, context) => {
        const record = await service.read(key, range, sink, context);
        if (changed) return { ...record, sha256: 'b'.repeat(64) };
        throw new InputByteError('integrity');
      },
    }),
  );
  try {
    const record = await publish(app, 'id\n1\n');
    const url = `${base}/${record.id}/columns?kind=csv`;
    const failed = await app.server.inject({ url, headers: app.headers });
    expect(failed.statusCode).not.toBe(200);
    expect(failed.json()).not.toHaveProperty('columns');
    changed = true;
    const mismatch = await app.server.inject({ url, headers: app.headers });
    expect(mismatch.statusCode).toBe(500);
    expect(mismatch.json()).not.toHaveProperty('columns');
  } finally {
    await app.close();
  }
});
it('retains the request lifetime through cancellation until the original read has settled', async () => {
  const entered = deferred();
  const release = deferred();
  const app = await setup(fixture, (service) =>
    wrap(service, {
      read: async (...args) => {
        entered.resolve();
        await release.promise;
        return service.read(...args);
      },
    }),
  );
  try {
    const record = await publish(app, 'id\n1\n');
    const pending = app.server.inject({ url: `${base}/${record.id}/columns?kind=csv`, headers: app.headers });
    await entered.promise;
    let closed = false;
    const close = app.http.close().then(() => {
      closed = true;
    });
    await turn();
    expect(closed).toBe(false);
    release.resolve();
    const result = await pending;
    expect(result.statusCode).not.toBe(200);
    expect(result.json()).not.toHaveProperty('columns');
    await close;
  } finally {
    release.resolve();
    await app.close();
  }
});
